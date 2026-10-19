import { maxAnswerCost, MODEL_PRICES, type Effort, type ModelPrice } from '@portfolio/assistant';

type Env = Record<string, string | undefined>;

export type AiProvider = 'bedrock' | 'anthropic' | 'scripted';

export interface AiConfig {
  provider: AiProvider;
  /** The model, as priced: e.g. "claude-opus-5-5". */
  model: string;
  /** The id the provider expects: e.g. "anthropic.claude-opus-5-5" on Bedrock. */
  providerModelId: string;
  price: ModelPrice;
  effort: Effort;
  bedrock: { region: string; roleArn?: string };
  anthropicApiKey?: string;
  maxOutputTokens: number;
  maxRounds: number;
  /** No model call may start whose input could exceed this. Keeps Haiku 5.5 in its ≤100K-token price band too. */
  maxInputTokensPerCall: number;
  timeoutMs: number;
  /**
   * The most one answer can cost for this model: maxRounds × (maxInputTokensPerCall at the dearer of the
   * input and cache-write prices + maxOutputTokens at the output price). Reserved before each answer.
   */
  maxCostPerAnswerUsd: number;
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
  questionsPerMinute: number;
  questionsPerDay: number;
  transcriptSecret: string;
}

export type AiConfigResult = { ok: true; config: AiConfig } | { ok: false; reason: string };

// Development only: a per-process secret, so local conversations work without configuration.
const developmentSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

const number = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== undefined && value.trim() !== '' ? Math.min(max, Math.max(min, parsed)) : fallback;
};

/**
 * Reads AI settings from the environment. Anything missing or unsafe makes the
 * assistant unavailable (the terminal's commands are unaffected), never
 * "configured with a guess".
 */
export function resolveAiConfig(env: Env): AiConfigResult {
  if (env.AI_ENABLED?.trim().toLowerCase() === 'false') return { ok: false, reason: 'AI_ENABLED is false.' };

  const isProduction = env.NODE_ENV === 'production';
  const provider = (env.AI_PROVIDER?.trim().toLowerCase() || (isProduction ? '' : 'scripted')) as AiProvider | '';
  if (provider === '') return { ok: false, reason: 'AI_PROVIDER is not set.' };
  if (!['bedrock', 'anthropic', 'scripted'].includes(provider)) return { ok: false, reason: `Unknown AI_PROVIDER "${provider}".` };
  if (provider === 'scripted' && env.VERCEL_ENV === 'production') {
    return { ok: false, reason: 'The scripted model is for development and tests, not production.' };
  }

  const model = env.AI_MODEL?.trim() || 'claude-opus-5-5';
  const price = MODEL_PRICES[model];
  if (price === undefined) return { ok: false, reason: `No verified price for "${model}", so its spend can't be capped.` };

  const transcriptSecret = env.CHAT_TRANSCRIPT_SECRET ?? (isProduction ? '' : developmentSecret);
  if (transcriptSecret.length < 32) return { ok: false, reason: 'CHAT_TRANSCRIPT_SECRET must be at least 32 characters.' };

  const roleArn = env.AI_BEDROCK_ROLE_ARN?.trim() || undefined;
  if (provider === 'bedrock' && env.VERCEL === '1' && roleArn === undefined) {
    return { ok: false, reason: 'AI_BEDROCK_ROLE_ARN is required on Vercel (OIDC; no stored AWS keys).' };
  }
  const anthropicApiKey = env.ANTHROPIC_API_KEY?.trim() || undefined;
  if (provider === 'anthropic' && anthropicApiKey === undefined) return { ok: false, reason: 'ANTHROPIC_API_KEY is not set.' };

  const effort = (['low', 'medium', 'high'] as const).find((level) => level === env.AI_EFFORT?.trim().toLowerCase()) ?? 'low';
  const providerModelId = env.AI_PROVIDER_MODEL_ID?.trim() || (provider === 'bedrock' ? `anthropic.${model}` : model);

  const limits = {
    maxOutputTokens: number(env.AI_MAX_OUTPUT_TOKENS, 1024, 256, 4096),
    maxRounds: number(env.AI_MAX_TOOL_ROUNDS, 4, 1, 6),
    maxInputTokensPerCall: number(env.AI_MAX_INPUT_TOKENS_PER_CALL, 24_000, 8_000, 90_000),
  };
  // Rounded up to the next millionth of a dollar, so the reservation is never below the true ceiling.
  const maxCostPerAnswerUsd = Math.ceil(maxAnswerCost(price, limits) * 1_000_000) / 1_000_000;
  const dailyBudgetUsd = number(env.AI_DAILY_BUDGET_USD, 10, 0, 1000);
  if (maxCostPerAnswerUsd > dailyBudgetUsd) {
    return { ok: false, reason: `One ${model} answer could cost $${maxCostPerAnswerUsd.toFixed(2)}, more than the daily budget.` };
  }

  return {
    ok: true,
    config: {
      provider,
      model,
      providerModelId,
      price,
      effort,
      bedrock: { region: env.AI_BEDROCK_REGION?.trim() || env.AWS_REGION?.trim() || 'eu-west-1', ...(roleArn && { roleArn }) },
      ...(anthropicApiKey && { anthropicApiKey }),
      ...limits,
      timeoutMs: number(env.AI_TIMEOUT_MS, 30_000, 5_000, 55_000),
      maxCostPerAnswerUsd,
      dailyBudgetUsd,
      monthlyBudgetUsd: number(env.AI_MONTHLY_BUDGET_USD, 50, 0, 10_000),
      questionsPerMinute: number(env.AI_QUESTIONS_PER_MINUTE, 5, 1, 60),
      questionsPerDay: number(env.AI_QUESTIONS_PER_DAY, 30, 1, 1000),
      transcriptSecret,
    },
  };
}
