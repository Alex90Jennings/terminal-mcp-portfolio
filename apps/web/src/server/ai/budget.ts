import { Redis } from '@upstash/redis';
import { REDIS_NAMESPACE, resolveBackend } from '../rate-limit';

type Env = Record<string, string | undefined>;

/*
 * The AI spend budget: a daily and a monthly cap, shared by every server
 * instance. Before an answer starts, its maximum possible cost is reserved
 * with atomic increments; afterwards the reservation is settled to the actual
 * cost. Concurrent answers therefore can't overspend between them: each one's
 * worst case is already counted. Anything that goes wrong refuses the answer.
 */

export interface Reservation {
  amountMicros: number;
  keys: { day: string; month: string };
}

export type ReserveResult = { ok: true; reservation: Reservation } | { ok: false; reason: 'daily' | 'monthly' | 'unavailable' };

export interface BudgetStore {
  reserve(amountMicros: number, now: Date): Promise<ReserveResult>;
  /** Replaces a reservation with what the answer actually cost. Never throws. */
  settle(reservation: Reservation, actualMicros: number): Promise<void>;
}

/** The budget's counters; separate from the rate-limit namespace. */
export const BUDGET_PREFIX = `${REDIS_NAMESPACE}:budget:ai`;

/** The one counter operation the budget needs. */
export interface Counters {
  /**
   * Atomically adds `amount` to the counter and returns the new value. If the
   * counter has no expiry (it is new), it gets `ttlSeconds`; an existing expiry
   * is left alone.
   */
  incrby(key: string, amount: number, ttlSeconds: number): Promise<number>;
}

/**
 * INCRBY and EXPIRE in one script, so they're atomic: a counter can never be
 * left without an expiry, even if the connection fails between the two. It
 * touches only the key it's given and never deletes anything.
 */
export const INCRBY_WITH_TTL_SCRIPT = `local value = redis.call('INCRBY', KEYS[1], ARGV[1])
if redis.call('TTL', KEYS[1]) == -1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return value`;

/** Counters on Upstash Redis. */
export function redisCounters(redis: Pick<Redis, 'eval'>): Counters {
  return {
    incrby: async (key, amount, ttlSeconds) => Number(await redis.eval(INCRBY_WITH_TTL_SCRIPT, [key], [amount, ttlSeconds])),
  };
}

export const toMicros = (usd: number): number => Math.ceil(usd * 1_000_000);
export const STORE_TIMEOUT_MS = 750;

const DAY_SECONDS = 86_400;
/** A day's counter outlives its day; a month's outlives its longest month. */
export const BUDGET_TTL_SECONDS = { day: 2 * DAY_SECONDS, month: 35 * DAY_SECONDS } as const;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('budget store timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function counterBudget(
  counters: Counters,
  limits: { dailyMicros: number; monthlyMicros: number },
  options: { prefix?: string; timeoutMs?: number; log?: (line: string) => void } = {},
): BudgetStore {
  const prefix = options.prefix ?? BUDGET_PREFIX;
  const timeoutMs = options.timeoutMs ?? STORE_TIMEOUT_MS;
  const log = options.log ?? ((line: string) => console.error(line));
  const op = <T>(promise: Promise<T>) => withTimeout(promise, timeoutMs);

  return {
    async reserve(amountMicros, now) {
      const iso = now.toISOString();
      const keys = { day: `${prefix}:day:${iso.slice(0, 10)}`, month: `${prefix}:month:${iso.slice(0, 7)}` };
      try {
        const day = await op(counters.incrby(keys.day, amountMicros, BUDGET_TTL_SECONDS.day));
        if (day > limits.dailyMicros) {
          await op(counters.incrby(keys.day, -amountMicros, BUDGET_TTL_SECONDS.day));
          return { ok: false, reason: 'daily' };
        }
        const month = await op(counters.incrby(keys.month, amountMicros, BUDGET_TTL_SECONDS.month));
        if (month > limits.monthlyMicros) {
          await op(counters.incrby(keys.month, -amountMicros, BUDGET_TTL_SECONDS.month));
          await op(counters.incrby(keys.day, -amountMicros, BUDGET_TTL_SECONDS.day));
          return { ok: false, reason: 'monthly' };
        }
        return { ok: true, reservation: { amountMicros, keys } };
      } catch (error) {
        // Whatever was incremented stays counted: an over-count can only refuse answers, never overspend.
        log(JSON.stringify({ event: 'ai.budget.unavailable', errorType: error instanceof Error ? error.name : typeof error }));
        return { ok: false, reason: 'unavailable' };
      }
    },

    async settle(reservation, actualMicros) {
      const delta = actualMicros - reservation.amountMicros;
      if (delta === 0) return;
      try {
        await op(counters.incrby(reservation.keys.day, delta, BUDGET_TTL_SECONDS.day));
        await op(counters.incrby(reservation.keys.month, delta, BUDGET_TTL_SECONDS.month));
      } catch (error) {
        // The reservation stays counted instead: conservative, never under-counted.
        log(JSON.stringify({ event: 'ai.budget.settle_failed', deltaMicros: delta, errorType: error instanceof Error ? error.name : typeof error }));
      }
    },
  };
}

/** In-process counters for development and tests, recording each counter's expiry (in seconds) like Redis would. */
export function memoryCounters(): Counters & { values: Map<string, number>; ttls: Map<string, number> } {
  const values = new Map<string, number>();
  const ttls = new Map<string, number>();
  return {
    values,
    ttls,
    incrby: async (key, amount, ttlSeconds) => {
      const next = (values.get(key) ?? 0) + amount;
      values.set(key, next);
      if (!ttls.has(key)) ttls.set(key, ttlSeconds);
      return next;
    },
  };
}

const unavailable: BudgetStore = {
  reserve: async () => ({ ok: false, reason: 'unavailable' }),
  settle: async () => {},
};

/** Same backend rules as rate limiting: Upstash in production, never a silent in-memory fallback. */
export function createBudgetStore(limits: { dailyUsd: number; monthlyUsd: number }, env: Env = process.env): BudgetStore {
  const backend = resolveBackend(env);
  const micros = { dailyMicros: toMicros(limits.dailyUsd), monthlyMicros: toMicros(limits.monthlyUsd) };
  switch (backend.kind) {
    case 'upstash':
      return counterBudget(redisCounters(new Redis({ url: backend.url, token: backend.token, retry: { retries: 1, backoff: () => 50 } })), micros);
    case 'memory':
      return counterBudget(memoryCounters(), micros);
    case 'unavailable':
      console.error(JSON.stringify({ event: 'ai.budget.unavailable', message: backend.reason }));
      return unavailable;
  }
}
