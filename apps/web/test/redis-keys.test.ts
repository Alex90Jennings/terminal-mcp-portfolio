import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Redis } from '@upstash/redis';
import { describe, expect, it } from 'vitest';
import { BUDGET_PREFIX, BUDGET_TTL_SECONDS, INCRBY_WITH_TTL_SCRIPT, counterBudget, memoryCounters, redisCounters } from '@/server/ai/budget';
import { RATE_LIMIT_PREFIX, REDIS_NAMESPACE, rateLimitPrefix, upstashStore } from '@/server/rate-limit';

/*
 * The Redis database is shared with another application, so every key the
 * portfolio touches must sit under "portfolio:", rate limits and the budget
 * must not overlap, and nothing may ever be deleted, scanned or flushed.
 */

// Every limiter the application creates (src/server/mcp.ts and src/server/ai/index.ts).
const LIMITERS = ['mcp', 'ai-minute', 'ai-day'];
// Commands that could delete, move or enumerate someone else's keys.
const DESTRUCTIVE = new Set(['DEL', 'UNLINK', 'FLUSHDB', 'FLUSHALL', 'KEYS', 'SCAN', 'RENAME', 'RENAMENX', 'SWAPDB', 'MOVE', 'COPY']);
/** The Redis commands a Lua script calls. */
const commandsIn = (script: string) => [...script.matchAll(/redis\.call\(\s*["']([A-Za-z]+)["']/g)].map(([, command]) => command!.toUpperCase());

/** Stands in for Upstash Redis: records every script call, and fails on any other command. */
function recordingRedis(reply: unknown) {
  const calls: { script: string; keys: string[]; args: unknown[] }[] = [];
  const redis = {
    // The library tries the cached script first; answering NOSCRIPT makes it send the script text, so we can inspect it.
    evalsha: async () => {
      throw new Error('NOSCRIPT No matching script');
    },
    eval: async (script: string, keys: string[], args: unknown[]) => {
      calls.push({ script, keys, args });
      return reply;
    },
  };
  return { calls, redis: new Proxy(redis, { get: (target, name) => (name in target ? target[name as keyof typeof target] : failOn(String(name))) }) };
}
const failOn = (command: string) => () => {
  throw new Error(`Unexpected Redis command: ${command}`);
};

describe('Redis key namespaces', () => {
  it('puts rate limits and the budget in separate namespaces under portfolio:', () => {
    expect(RATE_LIMIT_PREFIX).toBe('portfolio:ratelimit');
    expect(BUDGET_PREFIX).toBe('portfolio:budget:ai');
    for (const prefix of [RATE_LIMIT_PREFIX, BUDGET_PREFIX]) expect(prefix.startsWith(`${REDIS_NAMESPACE}:`)).toBe(true);
    expect(`${RATE_LIMIT_PREFIX}:`.startsWith(`${BUDGET_PREFIX}:`) || `${BUDGET_PREFIX}:`.startsWith(`${RATE_LIMIT_PREFIX}:`)).toBe(false);
  });

  it('gives each limiter its own prefix inside the rate-limit namespace', () => {
    const prefixes = LIMITERS.map(rateLimitPrefix);
    expect(prefixes).toEqual(['portfolio:ratelimit:mcp', 'portfolio:ratelimit:ai-minute', 'portfolio:ratelimit:ai-day']);
    for (const prefix of prefixes) expect(prefix.startsWith(`${BUDGET_PREFIX}:`)).toBe(false);
  });

  it.each(['', 'ai:spend', '../budget', 'MCP', 'a b', '*'])('rejects a limiter name that could escape its namespace: %j', (name) => {
    expect(() => rateLimitPrefix(name)).toThrow(/Invalid limiter name/);
  });
});

describe('the rate limiter against Redis', () => {
  it.each(LIMITERS)('%s only runs a non-destructive script on its own keys', async (name) => {
    const { calls, redis } = recordingRedis([4, 5]);
    const store = upstashStore({ name, requests: 5, windowSeconds: 60 }, redis as unknown as Redis);
    const result = await store.limit('abc123');
    expect(result).toMatchObject({ success: true, limit: 5, remaining: 4 });
    expect(calls).toHaveLength(1);
    for (const key of calls[0]!.keys) expect(key.startsWith(`${rateLimitPrefix(name)}:abc123:`)).toBe(true);
    const commands = commandsIn(calls[0]!.script);
    expect(commands).toContain('INCRBY');
    expect(commands).toContain('PEXPIRE');
    expect(commands.filter((command) => DESTRUCTIVE.has(command))).toEqual([]);
  });
});

describe('the budget against Redis', () => {
  it('runs one atomic script that increments, sets an expiry only when missing, and deletes nothing', async () => {
    const { calls, redis } = recordingRedis('1500');
    const counters = redisCounters(redis as unknown as Pick<Redis, 'eval'>);
    expect(await counters.incrby('portfolio:budget:ai:day:2026-10-19', 1500, BUDGET_TTL_SECONDS.day)).toBe(1500);
    expect(calls).toEqual([{ script: INCRBY_WITH_TTL_SCRIPT, keys: ['portfolio:budget:ai:day:2026-10-19'], args: [1500, 172_800] }]);
    expect(commandsIn(INCRBY_WITH_TTL_SCRIPT)).toEqual(['INCRBY', 'TTL', 'EXPIRE']);
    // Only a key with no expiry (TTL -1) gets one, so an existing expiry is never extended.
    expect(INCRBY_WITH_TTL_SCRIPT).toMatch(/TTL', KEYS\[1\]\) == -1 then/);
  });

  it('writes only its own keys, each with an expiry, and leaves other applications’ keys untouched', async () => {
    const counters = memoryCounters();
    const foreign = new Map([
      ['@upstash/ratelimit:contact:203.0.113.7:1234', 3],
      ['contact-rate-limit:203.0.113.7', 7],
      ['portfolio:ratelimit:ai-day:abc123:20380', 2],
    ]);
    for (const [key, value] of foreign) counters.values.set(key, value);
    const budget = counterBudget(counters, { dailyMicros: 1_000_000, monthlyMicros: 1_500_000 });
    const now = new Date('2026-10-19T12:00:00Z');

    const first = await budget.reserve(600_000, now);
    if (!first.ok) throw new Error('expected a reservation');
    await budget.settle(first.reservation, 200_000);
    expect(await budget.reserve(900_000, now)).toEqual({ ok: false, reason: 'daily' });
    const tomorrow = new Date('2026-10-20T12:00:00Z');
    expect((await budget.reserve(900_000, tomorrow)).ok).toBe(true);
    expect(await budget.reserve(900_000, new Date('2026-10-21T12:00:00Z'))).toEqual({ ok: false, reason: 'monthly' });

    for (const [key, value] of foreign) expect(counters.values.get(key), key).toBe(value);
    const own = [...counters.values.keys()].filter((key) => !foreign.has(key));
    expect(own.sort()).toEqual([
      'portfolio:budget:ai:day:2026-10-19',
      'portfolio:budget:ai:day:2026-10-20',
      'portfolio:budget:ai:day:2026-10-21',
      'portfolio:budget:ai:month:2026-10',
    ]);
    for (const key of own) expect(counters.ttls.get(key), key).toBe(key.includes(':day:') ? BUDGET_TTL_SECONDS.day : BUDGET_TTL_SECONDS.month);
    expect(counters.values.get('portfolio:budget:ai:day:2026-10-19')).toBe(200_000);
    expect(counters.values.get('portfolio:budget:ai:month:2026-10')).toBe(1_100_000);
  });

  it('stays exact under concurrent reservations', async () => {
    const counters = memoryCounters();
    const budget = counterBudget(counters, { dailyMicros: 10_000_000, monthlyMicros: 50_000_000 });
    const now = new Date('2026-10-19T12:00:00Z');
    const results = await Promise.all(Array.from({ length: 40 }, () => budget.reserve(561_920, now)));
    const granted = results.filter((result) => result.ok).length;
    expect(granted).toBe(Math.floor(10_000_000 / 561_920));
    expect(counters.values.get('portfolio:budget:ai:day:2026-10-19')).toBe(granted * 561_920);
  });
});

describe('the source code', () => {
  const root = path.resolve(import.meta.dirname, '../../..');
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) return entry === 'node_modules' || entry.startsWith('.') ? [] : sourceFiles(full);
      return /\.(ts|tsx|mjs|js)$/.test(entry) ? [full] : [];
    });
  const files = [path.join(root, 'apps/web/src'), path.join(root, 'apps/web/evaluation'), ...['knowledge', 'mcp-server', 'assistant'].map((name) => path.join(root, 'packages', name, 'src'))].flatMap(sourceFiles);

  it('is scanned', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('never flushes, deletes, scans or lists Redis keys', () => {
    const offending = files.filter((file) => {
      const text = readFileSync(file, 'utf8');
      return /\b(flushdb|flushall)\b/i.test(text) || /\.(del|unlink|scan|keys|flushdb|flushall|rename)\s*\(/.test(text.replace(/Object\.keys\(|\.keys\(\)/g, ''));
    });
    expect(offending.map((file) => path.relative(root, file))).toEqual([]);
  });
});
