import { describe, expect, it, vi } from 'vitest';
import {
  clientKey,
  createLimiter,
  FAILURE_LOG_INTERVAL_MS,
  memoryLimiter,
  parseFailureMode,
  resolveBackend,
  sharedLimiter,
  type LimitConfig,
  type SharedStore,
} from '@/server/rate-limit';

const credentials = { UPSTASH_REDIS_REST_URL: 'https://example.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'token' };

describe('resolveBackend', () => {
  it('requires Upstash in production', () => {
    expect(resolveBackend({ NODE_ENV: 'production', ...credentials })).toEqual({ kind: 'upstash', url: credentials.UPSTASH_REDIS_REST_URL, token: 'token' });
  });

  it('never falls back silently: production without credentials is unavailable', () => {
    expect(resolveBackend({ NODE_ENV: 'production' })).toMatchObject({ kind: 'unavailable', reason: expect.stringMatching(/UPSTASH_REDIS_REST_URL/) });
    expect(resolveBackend({ NODE_ENV: 'production', UPSTASH_REDIS_REST_URL: 'https://example.upstash.io' }).kind).toBe('unavailable');
  });

  it('refuses in-memory limiting on Vercel, even when asked for', () => {
    expect(resolveBackend({ NODE_ENV: 'production', VERCEL: '1', RATE_LIMIT_BACKEND: 'memory' }).kind).toBe('unavailable');
  });

  it('allows in-memory limiting in development, or when explicitly requested off Vercel', () => {
    expect(resolveBackend({ NODE_ENV: 'development' }).kind).toBe('memory');
    expect(resolveBackend({ NODE_ENV: 'production', RATE_LIMIT_BACKEND: 'memory' }).kind).toBe('memory');
  });

  it('rejects an unknown backend name', () => {
    expect(resolveBackend({ RATE_LIMIT_BACKEND: 'postgres' }).kind).toBe('unavailable');
  });
});

describe('createLimiter', () => {
  it('refuses every request (503) and logs once when unavailable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Missing credentials refuse requests even for a limiter configured to fail open.
    const limiter = createLimiter({ name: 'test', requests: 5, windowSeconds: 60, failureMode: 'open' }, { NODE_ENV: 'production' });
    expect(await limiter('a')).toEqual({ ok: false, status: 503 });
    expect(await limiter('b')).toEqual({ ok: false, status: 503 });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe('memoryLimiter', () => {
  it('allows the configured number per window, then 429 with Retry-After, then resets', async () => {
    let time = 0;
    const limiter = memoryLimiter({ requests: 2, windowSeconds: 60 }, () => time);
    expect(await limiter('ip')).toMatchObject({ ok: true, headers: { 'RateLimit-Remaining': '1' } });
    expect(await limiter('ip')).toMatchObject({ ok: true, headers: { 'RateLimit-Remaining': '0' } });
    expect(await limiter('ip')).toMatchObject({ ok: false, status: 429, retryAfterSeconds: 60 });
    expect(await limiter('other')).toMatchObject({ ok: true });
    time = 60_000;
    expect(await limiter('ip')).toMatchObject({ ok: true });
  });

  it('bounds its memory', async () => {
    const limiter = memoryLimiter({ requests: 1, windowSeconds: 60 }, () => 0, 3);
    for (const key of ['a', 'b', 'c', 'd', 'e']) expect(await limiter(key)).toMatchObject({ ok: true });
  });
});

describe('clientKey', () => {
  const request = (headers: Record<string, string>) => new Request('https://example.com', { headers });

  it('hashes the client IP rather than storing it', async () => {
    const key = await clientKey(request({ 'x-real-ip': '203.0.113.7' }));
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain('203');
  });

  it('uses the first x-forwarded-for address when x-real-ip is absent', async () => {
    expect(await clientKey(request({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe(await clientKey(request({ 'x-real-ip': '203.0.113.7' })));
  });

  it('separates different clients', async () => {
    expect(await clientKey(request({ 'x-real-ip': '203.0.113.7' }))).not.toBe(await clientKey(request({ 'x-real-ip': '203.0.113.8' })));
  });
});

describe('parseFailureMode', () => {
  it('reads open and closed, and keeps the default when unset', () => {
    expect(parseFailureMode('open', 'closed')).toBe('open');
    expect(parseFailureMode(' CLOSED ', 'open')).toBe('closed');
    expect(parseFailureMode(undefined, 'open')).toBe('open');
  });

  it('treats an unrecognised value as closed, the safe choice', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseFailureMode('sometimes', 'open')).toBe('closed');
    error.mockRestore();
  });
});

describe('sharedLimiter', () => {
  const config = (failureMode: LimitConfig['failureMode']): LimitConfig => ({ name: 'mcp', requests: 60, windowSeconds: 60, failureMode });
  const failing: SharedStore = {
    limit: async () => {
      throw new Error('fetch failed: https://secret-db.upstash.io token=AXsecret key=abc123');
    },
  };
  const hanging: SharedStore = { limit: () => new Promise(() => {}) };
  const upstashTimeout: SharedStore = { limit: async () => ({ success: true, limit: 60, remaining: 60, reset: 0, reason: 'timeout' }) };

  it('maps store answers to outcomes with rate-limit headers', async () => {
    const now = () => 1_000;
    const allow = sharedLimiter(config('closed'), { limit: async () => ({ success: true, limit: 60, remaining: 59, reset: 31_000 }) }, { now });
    expect(await allow('k')).toEqual({ ok: true, headers: { 'RateLimit-Limit': '60', 'RateLimit-Remaining': '59', 'RateLimit-Reset': '30' } });
    const deny = sharedLimiter(config('closed'), { limit: async () => ({ success: false, limit: 60, remaining: 0, reset: 11_000 }) }, { now });
    expect(await deny('k')).toMatchObject({ ok: false, status: 429, retryAfterSeconds: 10 });
  });

  it.each([
    ['an error', failing],
    ['a hang', hanging],
    ['Upstash’s own timeout', upstashTimeout],
  ])('fails open on %s when configured open', async (_, store) => {
    const limiter = sharedLimiter(config('open'), store, { log: () => {}, timeoutMs: 20 });
    expect(await limiter('k')).toEqual({ ok: true });
  });

  it.each([
    ['an error', failing],
    ['a hang', hanging],
    ['Upstash’s own timeout', upstashTimeout],
  ])('fails closed (503) on %s when configured closed', async (_, store) => {
    const limiter = sharedLimiter(config('closed'), store, { log: () => {}, timeoutMs: 20 });
    expect(await limiter('k')).toEqual({ ok: false, status: 503 });
  });

  it('gives up on a slow store after the timeout', async () => {
    const limiter = sharedLimiter(config('open'), hanging, { log: () => {}, timeoutMs: 30 });
    const started = performance.now();
    await limiter('k');
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('logs failures without credentials, URLs, messages or client keys', async () => {
    const lines: string[] = [];
    const limiter = sharedLimiter(config('open'), failing, { log: (line) => lines.push(line) });
    await limiter('9f86d081884c7d659a2feaa0c55ad015');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      event: 'rate_limit.store_failure',
      limiter: 'mcp',
      cause: 'error',
      errorType: 'Error',
      action: 'allowed',
      suppressedSinceLastLog: 0,
    });
    expect(lines[0]).not.toMatch(/upstash\.io|AXsecret|abc123|9f86d081/);
  });

  it('logs at most once per interval, counting what it suppressed', async () => {
    let time = 0;
    const lines: string[] = [];
    const limiter = sharedLimiter(config('closed'), failing, { now: () => time, log: (line) => lines.push(line) });
    for (let i = 0; i < 50; i++) await limiter('k');
    expect(lines).toHaveLength(1);
    time = FAILURE_LOG_INTERVAL_MS;
    await limiter('k');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({ action: 'refused', suppressedSinceLastLog: 49 });
  });
});
