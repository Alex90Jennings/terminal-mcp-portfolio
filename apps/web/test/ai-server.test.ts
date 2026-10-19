import { describe, expect, it } from 'vitest';
import { counterBudget, createBudgetStore, memoryCounters, toMicros, type Counters } from '@/server/ai/budget';
import { resolveAiConfig } from '@/server/ai/config';

const limits = { dailyMicros: toMicros(10), monthlyMicros: toMicros(50) };
const now = new Date('2026-10-19T12:00:00Z');

describe('counterBudget', () => {
  it('reserves against both the daily and monthly caps, keyed by UTC date', async () => {
    const counters = memoryCounters();
    const result = await counterBudget(counters, limits).reserve(toMicros(0.5), now);
    expect(result).toEqual({
      ok: true,
      reservation: { amountMicros: 500_000, keys: { day: 'portfolio:budget:ai:day:2026-10-19', month: 'portfolio:budget:ai:month:2026-10' } },
    });
    expect([...counters.values.values()]).toEqual([500_000, 500_000]);
  });

  it('settles to the actual cost, up or down', async () => {
    const counters = memoryCounters();
    const budget = counterBudget(counters, limits);
    const result = await budget.reserve(500_000, now);
    if (!result.ok) throw new Error('expected a reservation');
    await budget.settle(result.reservation, 37_000);
    expect([...counters.values.values()]).toEqual([37_000, 37_000]);
  });

  it('never lets concurrent answers overspend the daily cap', async () => {
    const counters = memoryCounters();
    const budget = counterBudget(counters, limits);
    const results = await Promise.all(Array.from({ length: 50 }, () => budget.reserve(500_000, now)));
    expect(results.filter(({ ok }) => ok)).toHaveLength(20);
    expect(results.filter((result) => !result.ok && result.reason === 'daily')).toHaveLength(30);
    expect(counters.values.get('portfolio:budget:ai:day:2026-10-19')).toBe(10_000_000);
  });

  it('enforces the monthly cap across days, and rolls back the day when the month refuses', async () => {
    const counters = memoryCounters();
    counters.values.set('portfolio:budget:ai:month:2026-10', 49_800_000);
    const result = await counterBudget(counters, limits).reserve(500_000, now);
    expect(result).toEqual({ ok: false, reason: 'monthly' });
    expect(counters.values.get('portfolio:budget:ai:day:2026-10-19')).toBe(0);
    expect(counters.values.get('portfolio:budget:ai:month:2026-10')).toBe(49_800_000);
  });

  it('fails closed when the store errors or hangs, without logging details', async () => {
    const lines: string[] = [];
    const failing: Counters = {
      incrby: async () => {
        throw new Error('ECONNREFUSED https://secret.upstash.io token=abc');
      },
    };
    const hanging: Counters = { incrby: () => new Promise(() => {}) };
    expect(await counterBudget(failing, limits, { log: (line) => lines.push(line) }).reserve(1, now)).toEqual({ ok: false, reason: 'unavailable' });
    expect(await counterBudget(hanging, limits, { timeoutMs: 20, log: () => {} }).reserve(1, now)).toEqual({ ok: false, reason: 'unavailable' });
    expect(lines.join('')).not.toMatch(/upstash\.io|abc/);
  });

  it('leaves the reservation counted if settling fails: an over-count, never an under-count', async () => {
    const counters = memoryCounters();
    let broken = false;
    const flaky: Counters = {
      incrby: async (key, amount, ttlSeconds) => {
        if (broken) throw new Error('down');
        return counters.incrby(key, amount, ttlSeconds);
      },
    };
    const budget = counterBudget(flaky, limits, { log: () => {} });
    const result = await budget.reserve(500_000, now);
    if (!result.ok) throw new Error('expected a reservation');
    broken = true;
    await budget.settle(result.reservation, 1_000);
    expect([...counters.values.values()]).toEqual([500_000, 500_000]);
  });
});

describe('createBudgetStore', () => {
  it('refuses everything in production without Upstash (no silent in-memory fallback)', async () => {
    const original = console.error;
    console.error = () => {};
    const store = createBudgetStore({ dailyUsd: 10, monthlyUsd: 50 }, { NODE_ENV: 'production' });
    console.error = original;
    expect(await store.reserve(1, now)).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('resolveAiConfig', () => {
  const secret = 'x'.repeat(32);

  it('uses the scripted model in development, with the agreed defaults', () => {
    const result = resolveAiConfig({ NODE_ENV: 'development' });
    expect(result.ok && result.config).toMatchObject({
      provider: 'scripted',
      model: 'claude-opus-5-5',
      effort: 'low',
      maxOutputTokens: 1024,
      maxRounds: 4,
      maxInputTokensPerCall: 24_000,
      maxCostPerAnswerUsd: 0.56192,
      dailyBudgetUsd: 10,
      monthlyBudgetUsd: 50,
      questionsPerMinute: 5,
      questionsPerDay: 30,
    });
  });

  it('configures Bedrock with the anthropic.-prefixed model id and OIDC role', () => {
    const result = resolveAiConfig({
      NODE_ENV: 'production',
      VERCEL: '1',
      AI_PROVIDER: 'bedrock',
      AI_BEDROCK_ROLE_ARN: 'arn:aws:iam::123456789012:role/portfolio-bedrock',
      CHAT_TRANSCRIPT_SECRET: secret,
    });
    expect(result.ok && result.config).toMatchObject({
      provider: 'bedrock',
      providerModelId: 'anthropic.claude-opus-5-5',
      bedrock: { region: 'eu-west-1', roleArn: 'arn:aws:iam::123456789012:role/portfolio-bedrock' },
    });
  });

  it('switches to the Claude API by configuration alone', () => {
    const result = resolveAiConfig({ NODE_ENV: 'production', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test', CHAT_TRANSCRIPT_SECRET: secret, AI_MODEL: 'claude-haiku-5-5' });
    expect(result.ok && result.config).toMatchObject({ provider: 'anthropic', providerModelId: 'claude-haiku-5-5', price: { input: 0.1, output: 0.5 } });
  });

  it.each([
    ['switched off', { AI_ENABLED: 'false' }, /AI_ENABLED/],
    ['no provider in production', { NODE_ENV: 'production', CHAT_TRANSCRIPT_SECRET: secret }, /AI_PROVIDER/],
    ['an unknown provider', { AI_PROVIDER: 'openai' }, /Unknown AI_PROVIDER/],
    ['the scripted model in Vercel production', { AI_PROVIDER: 'scripted', VERCEL_ENV: 'production' }, /development and tests/],
    ['a model without a verified price', { AI_MODEL: 'claude-fable-5-1' }, /No verified price/],
    ['no transcript secret in production', { NODE_ENV: 'production', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }, /CHAT_TRANSCRIPT_SECRET/],
    ['Bedrock on Vercel without an OIDC role', { NODE_ENV: 'production', VERCEL: '1', AI_PROVIDER: 'bedrock', CHAT_TRANSCRIPT_SECRET: secret }, /AI_BEDROCK_ROLE_ARN/],
    ['the Claude API without a key', { AI_PROVIDER: 'anthropic' }, /ANTHROPIC_API_KEY/],
  ])('is unavailable with %s', (_, env, reason) => {
    const result = resolveAiConfig(env);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(reason);
  });

  it.each([
    ['claude-opus-5-5', 0.56192],
    ['claude-sonnet-5-5', 0.28096],
    ['claude-haiku-5-5', 0.014048],
  ])('reserves the exact worst case per answer for %s ($%s)', (model, usd) => {
    const result = resolveAiConfig({ AI_MODEL: model });
    expect(result.ok && result.config.maxCostPerAnswerUsd).toBe(usd);
  });

  it('refuses a configuration where one answer could exceed the daily budget', () => {
    const result = resolveAiConfig({ AI_DAILY_BUDGET_USD: '0.5' });
    expect(!result.ok && result.reason).toMatch(/more than the daily budget/);
  });

  it('caps input per call below Haiku 5.5’s 100K-token price band', () => {
    const result = resolveAiConfig({ AI_MAX_INPUT_TOKENS_PER_CALL: '500000' });
    expect(result.ok && result.config.maxInputTokensPerCall).toBe(90_000);
  });

  it('clamps numeric settings to safe ranges', () => {
    const result = resolveAiConfig({ AI_MAX_OUTPUT_TOKENS: '999999', AI_MAX_TOOL_ROUNDS: '0', AI_DAILY_BUDGET_USD: 'abc' });
    expect(result.ok && [result.config.maxOutputTokens, result.config.maxRounds, result.config.dailyBudgetUsd]).toEqual([4096, 1, 10]);
  });
});
