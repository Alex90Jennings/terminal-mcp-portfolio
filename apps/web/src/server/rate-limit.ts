import type { RateLimitOutcome } from '@portfolio/mcp-server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

type Env = Record<string, string | undefined>;

/**
 * What a limiter does when its shared store is configured but fails (an error
 * or a timeout): `open` lets the request through, `closed` refuses it (503).
 * Missing configuration always refuses, whatever the mode.
 *
 * Read-only MCP requests may run `open`, so an Upstash outage can't take a
 * free endpoint down. Anything that costs money, such as the AI chat, MUST use
 * `closed`.
 */
export type FailureMode = 'open' | 'closed';

export interface LimitConfig {
  /** Namespaces the counters and labels log lines, e.g. "mcp". */
  name: string;
  requests: number;
  windowSeconds: number;
  failureMode: FailureMode;
}

export type Limiter = (key: string) => Promise<RateLimitOutcome>;

/** The part of a shared counter store the limiter needs; Upstash's `Ratelimit` satisfies it. */
export interface SharedStore {
  limit(key: string): Promise<{ success: boolean; limit: number; remaining: number; reset: number; reason?: string }>;
}

export type Backend =
  | { kind: 'upstash'; url: string; token: string }
  | { kind: 'memory' }
  | { kind: 'unavailable'; reason: string };

/**
 * Every key the portfolio writes to Redis starts with this. The database may be
 * shared with other applications, so the portfolio never touches a key outside
 * it, and never deletes, scans or flushes.
 */
export const REDIS_NAMESPACE = 'portfolio';
/** Rate-limit counters live here; the AI budget has its own namespace (see ai/budget.ts). */
export const RATE_LIMIT_PREFIX = `${REDIS_NAMESPACE}:ratelimit`;

const LIMITER_NAME = /^[a-z0-9-]+$/;

/** The key prefix for one limiter. Names can't contain ":", so no limiter can reach another namespace. */
export function rateLimitPrefix(name: string): string {
  if (!LIMITER_NAME.test(name)) throw new Error(`Invalid limiter name "${name}": use lowercase letters, digits and hyphens.`);
  return `${RATE_LIMIT_PREFIX}:${name}`;
}

/** Longest we wait for the shared store before treating it as failed. */
export const STORE_TIMEOUT_MS = 750;
/** At most one failure log line per limiter per interval; the rest are counted. */
export const FAILURE_LOG_INTERVAL_MS = 60_000;

/**
 * Chooses the rate-limit store. Production needs a limiter shared by every
 * serverless instance, so it requires Upstash Redis. There is no silent
 * fallback: without credentials the limiter is unavailable and requests are
 * refused (503). In-memory limiting is for development and tests, and on any
 * deployed host it must be asked for explicitly; Vercel refuses it outright.
 *
 * - `RATE_LIMIT_BACKEND`: "upstash" or "memory". Defaults to "upstash" in production, "memory" otherwise.
 * - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`: the Upstash REST credentials.
 */
export function resolveBackend(env: Env): Backend {
  const requested = env.RATE_LIMIT_BACKEND ?? (env.NODE_ENV === 'production' ? 'upstash' : 'memory');
  if (requested === 'memory') {
    return env.VERCEL === '1'
      ? { kind: 'unavailable', reason: 'In-memory rate limiting is not allowed on Vercel; configure Upstash Redis.' }
      : { kind: 'memory' };
  }
  if (requested !== 'upstash') return { kind: 'unavailable', reason: `Unknown RATE_LIMIT_BACKEND "${requested}".` };
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return { kind: 'unavailable', reason: 'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required for rate limiting.' };
  }
  return { kind: 'upstash', url, token };
}

/** Reads a failure mode from configuration. Anything other than "open" or "closed" is treated as "closed". */
export function parseFailureMode(value: string | undefined, fallback: FailureMode): FailureMode {
  if (value === undefined || value.trim() === '') return fallback;
  const mode = value.trim().toLowerCase();
  if (mode === 'open' || mode === 'closed') return mode;
  console.error(JSON.stringify({ event: 'rate_limit.config', message: `Unrecognised failure mode; using "closed".` }));
  return 'closed';
}

export function createLimiter(config: LimitConfig, env: Env = process.env): Limiter {
  const backend = resolveBackend(env);
  switch (backend.kind) {
    case 'upstash':
      // One quick retry instead of Upstash's default five, so a failing store is noticed fast.
      return sharedLimiter(config, upstashStore(config, new Redis({ url: backend.url, token: backend.token, retry: { retries: 1, backoff: () => 50 } })));
    case 'memory':
      return memoryLimiter(config);
    case 'unavailable': {
      console.error(JSON.stringify({ event: 'rate_limit.unavailable', limiter: config.name, message: backend.reason }));
      return async () => ({ ok: false, status: 503 });
    }
  }
}

/**
 * The Upstash sliding-window store for one limiter. It only runs the library's
 * limit script (GET, INCRBY and PEXPIRE on this limiter's own keys); analytics,
 * the deny list and dynamic limits, which write or delete other keys, stay off.
 */
export function upstashStore(config: Pick<LimitConfig, 'name' | 'requests' | 'windowSeconds'>, redis: Redis): SharedStore {
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(config.requests, `${config.windowSeconds} s`),
    prefix: rateLimitPrefix(config.name),
    analytics: false,
    timeout: STORE_TIMEOUT_MS,
  });
}

function headersFor(limit: number, remaining: number, resetAt: number, now: number): Record<string, string> {
  return {
    'RateLimit-Limit': String(limit),
    'RateLimit-Remaining': String(Math.max(0, remaining)),
    'RateLimit-Reset': String(Math.max(0, Math.ceil((resetAt - now) / 1000))),
  };
}

/** Throttled logging of store failures: one line per interval, with a count of what was suppressed. */
function failureLogger(config: LimitConfig, now: () => number, log: (line: string) => void) {
  let lastLoggedAt = -Infinity;
  let suppressed = 0;
  return (cause: 'timeout' | 'error', error?: unknown) => {
    const time = now();
    if (time - lastLoggedAt < FAILURE_LOG_INTERVAL_MS) {
      suppressed += 1;
      return;
    }
    // Only the error's type: messages from an HTTP client can carry URLs, and keys and tokens must never be logged.
    const errorType = error instanceof Error ? error.name : undefined;
    log(
      JSON.stringify({
        event: 'rate_limit.store_failure',
        limiter: config.name,
        cause,
        ...(errorType !== undefined && { errorType }),
        action: config.failureMode === 'open' ? 'allowed' : 'refused',
        suppressedSinceLastLog: suppressed,
      }),
    );
    lastLoggedAt = time;
    suppressed = 0;
  };
}

/** A limiter over a shared store, applying the configured failure mode when the store errors or is slow. */
export function sharedLimiter(
  config: LimitConfig,
  store: SharedStore,
  options: { now?: () => number; log?: (line: string) => void; timeoutMs?: number } = {},
): Limiter {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? STORE_TIMEOUT_MS;
  const logFailure = failureLogger(config, now, options.log ?? ((line) => console.error(line)));
  const onFailure = (cause: 'timeout' | 'error', error?: unknown): RateLimitOutcome => {
    logFailure(cause, error);
    return config.failureMode === 'open' ? { ok: true } : { ok: false, status: 503 };
  };

  return async (key) => {
    const started = now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    try {
      const result = await Promise.race([store.limit(key), timeout]);
      // Upstash reports its own timeout as a success with reason "timeout"; it is a failure here.
      if (result === 'timeout' || result.reason === 'timeout') return onFailure('timeout');
      const headers = headersFor(result.limit, result.remaining, result.reset, started);
      if (result.success) return { ok: true, headers };
      return { ok: false, status: 429, retryAfterSeconds: Math.max(1, Math.ceil((result.reset - started) / 1000)), headers };
    } catch (error) {
      return onFailure('error', error);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** A fixed-window counter in this process. Development and tests only. */
export function memoryLimiter(config: Pick<LimitConfig, 'requests' | 'windowSeconds'>, now: () => number = Date.now, maxKeys = 10_000): Limiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return async (key) => {
    const time = now();
    let window = windows.get(key);
    if (window === undefined || window.resetAt <= time) {
      if (windows.size >= maxKeys) {
        for (const [candidate, entry] of windows) if (entry.resetAt <= time) windows.delete(candidate);
        if (windows.size >= maxKeys) windows.clear();
      }
      window = { count: 0, resetAt: time + config.windowSeconds * 1000 };
      windows.set(key, window);
    }
    window.count += 1;
    const headers = headersFor(config.requests, config.requests - window.count, window.resetAt, time);
    if (window.count <= config.requests) return { ok: true, headers };
    return { ok: false, status: 429, retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - time) / 1000)), headers };
  };
}

/**
 * A privacy-preserving key for the caller: a hash of the client IP as reported
 * by the hosting proxy. Raw addresses are never stored or logged.
 */
export async function clientKey(request: Request): Promise<string> {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = request.headers.get('x-real-ip')?.trim() || forwarded || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return Buffer.from(digest).toString('hex').slice(0, 32);
}
