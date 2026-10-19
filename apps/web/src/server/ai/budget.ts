import { Redis } from '@upstash/redis';
import { resolveBackend } from '../rate-limit';

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

/** The atomic counter operations the budget needs; Upstash Redis provides them. */
export interface Counters {
  incrby(key: string, amount: number): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export const toMicros = (usd: number): number => Math.ceil(usd * 1_000_000);
export const STORE_TIMEOUT_MS = 750;

const DAY_SECONDS = 86_400;

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
  const prefix = options.prefix ?? 'portfolio:ai:spend';
  const timeoutMs = options.timeoutMs ?? STORE_TIMEOUT_MS;
  const log = options.log ?? ((line: string) => console.error(line));
  const op = <T>(promise: Promise<T>) => withTimeout(promise, timeoutMs);

  return {
    async reserve(amountMicros, now) {
      const iso = now.toISOString();
      const keys = { day: `${prefix}:day:${iso.slice(0, 10)}`, month: `${prefix}:month:${iso.slice(0, 7)}` };
      try {
        const day = await op(counters.incrby(keys.day, amountMicros));
        if (day === amountMicros) await op(counters.expire(keys.day, 2 * DAY_SECONDS));
        if (day > limits.dailyMicros) {
          await op(counters.incrby(keys.day, -amountMicros));
          return { ok: false, reason: 'daily' };
        }
        const month = await op(counters.incrby(keys.month, amountMicros));
        if (month === amountMicros) await op(counters.expire(keys.month, 35 * DAY_SECONDS));
        if (month > limits.monthlyMicros) {
          await op(counters.incrby(keys.month, -amountMicros));
          await op(counters.incrby(keys.day, -amountMicros));
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
        await op(counters.incrby(reservation.keys.day, delta));
        await op(counters.incrby(reservation.keys.month, delta));
      } catch (error) {
        // The reservation stays counted instead: conservative, never under-counted.
        log(JSON.stringify({ event: 'ai.budget.settle_failed', deltaMicros: delta, errorType: error instanceof Error ? error.name : typeof error }));
      }
    },
  };
}

/** In-process counters for development and tests. */
export function memoryCounters(): Counters & { values: Map<string, number> } {
  const values = new Map<string, number>();
  return {
    values,
    incrby: async (key, amount) => {
      const next = (values.get(key) ?? 0) + amount;
      values.set(key, next);
      return next;
    },
    expire: async () => 1,
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
      return counterBudget(new Redis({ url: backend.url, token: backend.token, retry: { retries: 1, backoff: () => 50 } }), micros);
    case 'memory':
      return counterBudget(memoryCounters(), micros);
    case 'unavailable':
      console.error(JSON.stringify({ event: 'ai.budget.unavailable', message: backend.reason }));
      return unavailable;
  }
}
