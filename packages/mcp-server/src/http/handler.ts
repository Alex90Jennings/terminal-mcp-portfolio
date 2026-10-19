import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { checkHost, checkOrigin, corsHeaders, preflightHeaders, type OriginPolicy } from './origin.ts';

/** What a rate limiter decided for one request. */
export type RateLimitOutcome =
  | { ok: true; headers?: Record<string, string> }
  | { ok: false; status: 429; retryAfterSeconds: number; headers?: Record<string, string> }
  /** The limiter is missing or misconfigured: refuse rather than serve unlimited. */
  | { ok: false; status: 503 };

export interface McpLogEvent {
  /** JSON-RPC method, e.g. "tools/call", when the body could be parsed. */
  rpcMethod?: string;
  /** Tool or resource the call targeted, when there was one. */
  target?: string;
  status: number;
  durationMs: number;
  /** Why a request was refused before reaching the server, if it was. */
  rejected?: string;
}

export interface McpHandlerOptions {
  /** A fresh server per request: the endpoint is stateless, as serverless hosting needs. */
  createServer: () => McpServer;
  originPolicy: OriginPolicy;
  rateLimit?: (request: Request) => Promise<RateLimitOutcome>;
  /** Largest accepted request body. MCP requests to these tools are tiny. */
  maxBodyBytes?: number;
  log?: (event: McpLogEvent) => void;
}

export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

/**
 * A Streamable HTTP endpoint as a plain `Request → Response` function, so it
 * runs unchanged in a Next.js route, any Fetch-based server, or a test.
 */
export function createMcpHandler(options: McpHandlerOptions): (request: Request) => Promise<Response> {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const log = options.log ?? (() => {});

  return async (request) => {
    const started = performance.now();
    // Filled in once the body is parsed, so refusals before that are logged without them.
    const call: { rpcMethod?: string; target?: string } = {};
    const finish = (response: Response, rejected?: string): Response => {
      log({
        ...call,
        status: response.status,
        durationMs: Math.round(performance.now() - started),
        ...(rejected !== undefined && { rejected }),
      });
      return response;
    };

    const originCheck = checkOrigin(request.headers.get('origin'), options.originPolicy);
    if (!originCheck.ok) return finish(rpcError(403, 'Forbidden: Origin not allowed'), originCheck.reason);
    if (!checkHost(request.headers.get('host'), options.originPolicy)) {
      return finish(rpcError(403, 'Forbidden: unexpected Host'), 'host');
    }
    const cors = corsHeaders(originCheck.origin);

    if (request.method === 'OPTIONS') {
      return finish(new Response(null, { status: 204, headers: preflightHeaders(originCheck.origin) }));
    }
    if (request.method !== 'POST') {
      // Stateless: no server-to-client stream to open (GET) and no session to end (DELETE).
      return finish(rpcError(405, 'Method not allowed: this server is stateless; use POST', { ...cors, Allow: 'POST, OPTIONS' }), 'method');
    }
    if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      return finish(rpcError(415, 'Unsupported Media Type: Content-Type must be application/json', cors), 'content-type');
    }
    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (declaredLength > maxBodyBytes) return finish(rpcError(413, 'Request body too large', cors), 'size');

    const limit: RateLimitOutcome = options.rateLimit ? await options.rateLimit(request) : { ok: true };
    if (!limit.ok) {
      if (limit.status === 503) return finish(rpcError(503, 'Service unavailable', cors), 'rate-limiter-unavailable');
      return finish(
        rpcError(429, 'Too many requests. Please slow down.', { ...cors, ...limit.headers, 'Retry-After': String(limit.retryAfterSeconds) }),
        'rate-limit',
      );
    }

    const text = await readLimited(request, maxBodyBytes);
    if (text === null) return finish(rpcError(413, 'Request body too large', cors), 'size');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return finish(rpcError(400, 'Parse error', cors, ErrorCode.ParseError), 'parse');
    }
    // The spec requires a single JSON-RPC message per POST; batching was removed from the protocol.
    if (Array.isArray(body)) {
      return finish(rpcError(400, 'Invalid Request: send one JSON-RPC message per request (batches are not supported)', cors, ErrorCode.InvalidRequest), 'batch');
    }
    Object.assign(call, describe(body));

    let server: McpServer | undefined;
    // No `sessionIdGenerator` means stateless mode: no session ids, nothing kept between requests.
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    try {
      server = options.createServer();
      await server.connect(transport);
      const response = await transport.handleRequest(request, { parsedBody: body });
      const payload = response.status === 202 || response.body === null ? null : await response.text();
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries({ ...cors, ...limit.headers })) headers.set(name, value);
      return finish(new Response(payload, { status: response.status, headers }));
    } catch {
      return finish(rpcError(500, 'Internal error', cors, ErrorCode.InternalError), 'internal');
    } finally {
      await transport.close().catch(() => {});
      await server?.close().catch(() => {});
    }
  };
}

/** A transport-level refusal. Per the spec, these JSON-RPC error bodies carry no `id`. */
function rpcError(status: number, message: string, headers: Record<string, string> = {}, code: number = -32000): Response {
  return Response.json(
    { jsonrpc: '2.0', error: { code, message } },
    { status, headers: { ...headers, 'Content-Type': 'application/json' } },
  );
}

/** Reads the body as text, giving up (null) once it passes `limit` bytes, whatever Content-Length claimed. */
async function readLimited(request: Request, limit: number): Promise<string | null> {
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** For logs only: the JSON-RPC method and the tool or resource it names. Never logs arguments. */
function describe(body: unknown): { rpcMethod?: string; target?: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return {};
  const { method, params } = body as { method?: unknown; params?: { name?: unknown; uri?: unknown } };
  if (typeof method !== 'string') return {};
  const target = typeof params?.name === 'string' ? params.name : typeof params?.uri === 'string' ? params.uri : undefined;
  return { rpcMethod: method.slice(0, 64), ...(target !== undefined && { target: target.slice(0, 128) }) };
}
