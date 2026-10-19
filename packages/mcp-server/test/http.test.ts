import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { createMcpHandler, type McpHandlerOptions, type McpLogEvent, type RateLimitOutcome } from '../src/http/handler.ts';
import { createPortfolioServer } from '../src/server.ts';
import { kb } from './helpers.ts';

const URL_ = 'https://portfolio.example.com/api/mcp';

function handler(overrides: Partial<McpHandlerOptions> = {}) {
  return createMcpHandler({
    createServer: () => createPortfolioServer(kb),
    originPolicy: { allowedOrigins: '*', allowedHosts: ['portfolio.example.com'] },
    ...overrides,
  });
}

const headers = (extra: Record<string, string> = {}) => ({
  Host: 'portfolio.example.com',
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
  ...extra,
});

const rpc = (method: string, params: Record<string, unknown> = {}, id = 1) => JSON.stringify({ jsonrpc: '2.0', id, method, params });

const initialize = rpc('initialize', {
  protocolVersion: LATEST_PROTOCOL_VERSION,
  capabilities: {},
  clientInfo: { name: 'http-test', version: '1.0.0' },
});

const post = (body: string, extra: Record<string, string> = {}) =>
  new Request(URL_, { method: 'POST', headers: headers(extra), body });

describe('official client over Streamable HTTP', () => {
  it('discovers and calls tools, and reads resources, through the handler', async () => {
    const handle = handler();
    const transport = new StreamableHTTPClientTransport(new URL(URL_), {
      fetch: (input, init) => handle(new Request(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), Host: 'portfolio.example.com' } })),
    });
    const client = new Client({ name: 'http-test', version: '1.0.0' });
    // The SDK's own types predate `exactOptionalPropertyTypes`; the transport is the official one.
    await client.connect(transport as unknown as Transport);

    expect(client.getServerVersion()?.name).toBe('alex-jennings-portfolio');
    expect((await client.listTools()).tools).toHaveLength(6);
    const result = await client.callTool({ name: 'get_project', arguments: { project: 'sol', sections: ['decisions'] } });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { project: { id: string } }).project.id).toBe('sol');
    const { contents } = await client.readResource({ uri: 'portfolio://projects/sol' });
    expect(contents[0] && 'text' in contents[0] && contents[0].text).toMatch(/^# SOL/);
    await client.close();
  });
});

describe('protocol responses', () => {
  it('answers initialize with JSON, statelessly (no session id)', async () => {
    const response = await handler()(post(initialize));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('mcp-session-id')).toBeNull();
    const body = (await response.json()) as { result: { serverInfo: { name: string }; capabilities: Record<string, unknown> } };
    expect(body.result.serverInfo.name).toBe('alex-jennings-portfolio');
    expect(Object.keys(body.result.capabilities)).toEqual(expect.arrayContaining(['tools', 'resources', 'completions']));
  });

  it('serves tools/list without a prior initialize (stateless)', async () => {
    const response = await handler()(post(rpc('tools/list')));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { tools: unknown[] } };
    expect(body.result.tools).toHaveLength(6);
  });

  it('accepts notifications with 202 and no body', async () => {
    const response = await handler()(post(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })));
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('rejects clients that cannot accept JSON responses (406)', async () => {
    expect((await handler()(post(initialize, { Accept: 'text/html' }))).status).toBe(406);
  });

  it('rejects unsupported protocol versions (400)', async () => {
    expect((await handler()(post(rpc('tools/list'), { 'MCP-Protocol-Version': '1999-01-01' }))).status).toBe(400);
  });

  it('turns unknown methods into a JSON-RPC error, not a crash', async () => {
    const response = await handler()(post(rpc('tools/delete')));
    const body = (await response.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32601);
  });
});

describe('request validation', () => {
  it.each(['GET', 'DELETE', 'PUT'])('%s → 405 with Allow', async (method) => {
    const response = await handler()(new Request(URL_, { method, headers: headers() }));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST, OPTIONS');
  });

  it('wrong Content-Type → 415', async () => {
    expect((await handler()(post(initialize, { 'Content-Type': 'text/plain' }))).status).toBe(415);
  });

  it('declared oversize body → 413 before reading it', async () => {
    expect((await handler({ maxBodyBytes: 100 })(post(initialize, { 'Content-Length': '5000' }))).status).toBe(413);
  });

  it('actual oversize body → 413 even when Content-Length lies', async () => {
    const response = await handler({ maxBodyBytes: 100 })(post(rpc('tools/call', { name: 'search_projects', arguments: { query: 'x'.repeat(500) } })));
    expect(response.status).toBe(413);
  });

  it('invalid JSON → 400 parse error', async () => {
    const response = await handler()(post('{not json'));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: number } }).error.code).toBe(-32700);
  });
});

describe('Origin and Host validation', () => {
  it.each(['http://evil.example.com', 'null', 'file://x'])('Origin %s → 403', async (origin) => {
    const response = await handler()(post(initialize, { Origin: origin }));
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('wrong Host → 403 (DNS rebinding)', async () => {
    expect((await handler()(post(initialize, { Host: 'attacker.example' }))).status).toBe(403);
  });

  it('a secure cross-origin browser client gets CORS without credentials', async () => {
    const response = await handler()(post(initialize, { Origin: 'https://inspector.example.org' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://inspector.example.org');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(response.headers.get('vary')).toContain('Origin');
  });

  it('answers a CORS preflight', async () => {
    const response = await handler()(
      new Request(URL_, {
        method: 'OPTIONS',
        headers: { Host: 'portfolio.example.com', Origin: 'https://claude.ai', 'Access-Control-Request-Method': 'POST' },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toContain('Mcp-Protocol-Version');
  });
});

describe('rate limiting', () => {
  it('429 with Retry-After and rate-limit headers when the limiter says no', async () => {
    const rateLimit = async (): Promise<RateLimitOutcome> => ({ ok: false, status: 429, retryAfterSeconds: 42, headers: { 'RateLimit-Limit': '60' } });
    const response = await handler({ rateLimit })(post(initialize));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    expect(response.headers.get('ratelimit-limit')).toBe('60');
  });

  it('503 when no shared limiter is configured, rather than serving unlimited', async () => {
    const response = await handler({ rateLimit: async () => ({ ok: false, status: 503 }) })(post(initialize));
    expect(response.status).toBe(503);
  });

  it('passes the limiter’s headers through on success', async () => {
    const response = await handler({ rateLimit: async () => ({ ok: true, headers: { 'RateLimit-Remaining': '59' } }) })(post(initialize));
    expect(response.status).toBe(200);
    expect(response.headers.get('ratelimit-remaining')).toBe('59');
  });

  it('is checked before the server does any work', async () => {
    const createServer = vi.fn(() => createPortfolioServer(kb));
    await handler({ createServer, rateLimit: async () => ({ ok: false, status: 429, retryAfterSeconds: 1 }) })(post(initialize));
    expect(createServer).not.toHaveBeenCalled();
  });
});

describe('failures and logging', () => {
  it('an internal failure → 500 with a generic message', async () => {
    const response = await handler({
      createServer: () => {
        throw new Error('database password is hunter2');
      },
    })(post(initialize));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('hunter2');
  });

  it('logs method, target, status and duration, but never arguments', async () => {
    const events: McpLogEvent[] = [];
    await handler({ log: (event) => events.push(event) })(
      post(rpc('tools/call', { name: 'search_projects', arguments: { query: 'private search text' } })),
    );
    expect(events).toEqual([{ rpcMethod: 'tools/call', target: 'search_projects', status: 200, durationMs: expect.any(Number) }]);
    expect(JSON.stringify(events)).not.toContain('private search text');
  });

  it('logs why a request was rejected', async () => {
    const events: McpLogEvent[] = [];
    await handler({ log: (event) => events.push(event) })(post(initialize, { Origin: 'null' }));
    expect(events[0]).toMatchObject({ status: 403, rejected: 'opaque Origin ("null")' });
  });
});

/*
 * Streamable HTTP, MCP 2025-11-25 (basic/transports). Each test names the
 * requirement it checks.
 */
describe('Streamable HTTP compliance (2025-11-25)', () => {
  it('POST, request → a single JSON object (Content-Type: application/json), never an SSE stream', async () => {
    // "the server MUST either return Content-Type: text/event-stream … or Content-Type: application/json"
    const response = await handler()(post(initialize, { Accept: 'text/event-stream, application/json' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(JSON.parse(await response.text())).toMatchObject({ jsonrpc: '2.0', id: 1, result: expect.any(Object) });
  });

  it.each([
    ['application/json only', 'application/json'],
    ['text/event-stream only', 'text/event-stream'],
    ['a wildcard', '*/*'],
  ])('POST with Accept listing %s → 406 (client MUST list both types)', async (_, accept) => {
    // "The client MUST include an Accept header, listing both application/json and text/event-stream"
    expect((await handler()(post(initialize, { Accept: accept }))).status).toBe(406);
  });

  it('POST without Accept → 406', async () => {
    const request = new Request(URL_, {
      method: 'POST',
      headers: { Host: 'portfolio.example.com', 'Content-Type': 'application/json' },
      body: initialize,
    });
    expect((await handler()(request)).status).toBe(406);
  });

  it('POST, JSON-RPC response from the client → 202 Accepted, no body', async () => {
    // "If the input is a JSON-RPC response or notification … the server MUST return HTTP status code 202 Accepted with no body"
    const response = await handler()(post(JSON.stringify({ jsonrpc: '2.0', id: 7, result: {} })));
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('POST, batch (array) → 400 Invalid Request, even when every item is valid', async () => {
    // "The body of the POST request MUST be a single JSON-RPC request, notification, or response."
    const batch = JSON.stringify([JSON.parse(rpc('tools/list', {}, 1)), JSON.parse(rpc('resources/list', {}, 2))]);
    const response = await handler()(post(batch));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ jsonrpc: '2.0', error: { code: -32600, message: expect.stringMatching(/batches are not supported/) } });
  });

  it('POST, a body that is not JSON-RPC → 400', async () => {
    expect((await handler()(post(JSON.stringify({ hello: 'world' })))).status).toBe(400);
  });

  it('transport-level error bodies are JSON-RPC errors with no id', async () => {
    // "The HTTP response body MAY comprise a JSON-RPC error response that has no id"
    for (const response of [
      await handler()(post(initialize, { Origin: 'null' })),
      await handler()(new Request(URL_, { method: 'GET', headers: headers() })),
      await handler()(post('{oops')),
    ]) {
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ jsonrpc: '2.0', error: { code: expect.any(Number), message: expect.any(String) } });
      expect(body).not.toHaveProperty('id');
    }
  });

  it('GET → 405: this server offers no SSE stream', async () => {
    // "The server MUST either return Content-Type: text/event-stream in response to this HTTP GET, or else return HTTP 405"
    const response = await handler()(new Request(URL_, { method: 'GET', headers: { Host: 'portfolio.example.com', Accept: 'text/event-stream' } }));
    expect(response.status).toBe(405);
    expect(response.headers.get('content-type')).not.toMatch(/event-stream/);
  });

  it('DELETE → 405: clients cannot terminate sessions (there are none)', async () => {
    // "The server MAY respond to this request with HTTP 405 Method Not Allowed"
    const response = await handler()(new Request(URL_, { method: 'DELETE', headers: { ...headers(), 'Mcp-Session-Id': 'anything' } }));
    expect(response.status).toBe(405);
  });

  it.each(['HEAD', 'PUT', 'PATCH'])('%s → 405', async (method) => {
    expect((await handler()(new Request(URL_, { method, headers: headers() }))).status).toBe(405);
  });

  it('never assigns a session id', async () => {
    // Session ids are optional ("MAY assign"); a stateless server assigns none.
    const response = await handler()(post(initialize));
    expect(response.headers.get('mcp-session-id')).toBeNull();
  });

  it('a request without MCP-Protocol-Version is served (assumed 2025-03-26)', async () => {
    // "if the server does not receive an MCP-Protocol-Version header … the server SHOULD assume protocol version 2025-03-26"
    const withoutVersion = new Headers(headers());
    withoutVersion.delete('MCP-Protocol-Version');
    const response = await handler()(new Request(URL_, { method: 'POST', headers: withoutVersion, body: rpc('tools/list') }));
    expect(response.status).toBe(200);
  });

  it('negotiates the latest protocol version on initialize', async () => {
    const body = (await (await handler()(post(initialize))).json()) as { result: { protocolVersion: string } };
    expect(body.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    expect(LATEST_PROTOCOL_VERSION).toBe('2025-11-25');
  });
});
