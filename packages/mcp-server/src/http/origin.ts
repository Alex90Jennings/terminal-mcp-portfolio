/*
 * Origin and Host validation for the Streamable HTTP endpoint.
 *
 * The MCP specification requires servers to validate `Origin` and answer 403
 * when it is present and invalid (DNS-rebinding protection). This endpoint is
 * public, read-only and unauthenticated, so legitimate browser-based clients on
 * other sites are welcome: by default any secure (https) origin is accepted,
 * plus http on loopback for local tools. Malformed, opaque ("null") and other
 * insecure origins are refused. Requests without `Origin` (desktop and CLI
 * clients) are not browser requests and pass. CORS never allows credentials.
 */

export interface OriginPolicy {
  /** "*" accepts any well-formed secure origin (and loopback http); a list accepts exactly those origins. */
  allowedOrigins: '*' | readonly string[];
  /** Accepted `Host` names (no port). Empty disables the Host check. */
  allowedHosts: readonly string[];
}

export type OriginCheck = { ok: true; origin: string | null } | { ok: false; reason: string };

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function checkOrigin(header: string | null, policy: OriginPolicy): OriginCheck {
  if (header === null) return { ok: true, origin: null };
  const origin = header.trim().toLowerCase();
  if (origin === 'null') return { ok: false, reason: 'opaque Origin ("null")' };

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return { ok: false, reason: 'malformed Origin' };
  }
  if (url.origin === 'null' || url.origin !== origin) return { ok: false, reason: 'malformed Origin' };

  if (policy.allowedOrigins !== '*') {
    return policy.allowedOrigins.includes(origin) ? { ok: true, origin } : { ok: false, reason: 'Origin not in MCP_ALLOWED_ORIGINS' };
  }
  if (url.protocol === 'https:') return { ok: true, origin };
  if (url.protocol === 'http:' && LOOPBACK.has(url.hostname)) return { ok: true, origin };
  return { ok: false, reason: 'insecure Origin' };
}

/** True when the Host header names this deployment (or the check is disabled). */
export function checkHost(header: string | null, policy: OriginPolicy): boolean {
  if (policy.allowedHosts.length === 0) return true;
  if (header === null) return false;
  return policy.allowedHosts.includes(hostname(header));
}

/** "Example.com:443" → "example.com", "[::1]:3000" → "[::1]". */
function hostname(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
  return value.split(':')[0] ?? value;
}

export const CORS_ALLOWED_HEADERS = 'Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID';

/** Response headers for a validated cross-origin request. Never `Access-Control-Allow-Credentials`. */
export function corsHeaders(origin: string | null): Record<string, string> {
  if (origin === null) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Expose-Headers': 'Mcp-Protocol-Version, Mcp-Session-Id, Retry-After, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset',
    Vary: 'Origin',
  };
}

export function preflightHeaders(origin: string | null): Record<string, string> {
  return {
    ...corsHeaders(origin),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': CORS_ALLOWED_HEADERS,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin, Access-Control-Request-Headers',
  };
}

/**
 * Builds the policy from environment variables:
 * - `MCP_ALLOWED_ORIGINS`: "*" (default) or a comma-separated list of origins.
 * - `MCP_ALLOWED_HOSTS`: extra comma-separated host names. Vercel's deployment hosts
 *   are added automatically; in development, loopback hosts are allowed.
 */
export function resolveOriginPolicy(env: Record<string, string | undefined>): OriginPolicy {
  const list = (value: string | undefined) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase().replace(/\/+$/, ''))
      .filter(Boolean);

  const origins = list(env.MCP_ALLOWED_ORIGINS);
  const hosts = new Set([
    ...list(env.MCP_ALLOWED_HOSTS),
    ...list([env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).join(',')),
  ]);
  if (env.NODE_ENV === 'development') LOOPBACK.forEach((host) => hosts.add(host));

  return {
    allowedOrigins: origins.length === 0 || origins.includes('*') ? '*' : origins,
    allowedHosts: [...hosts],
  };
}
