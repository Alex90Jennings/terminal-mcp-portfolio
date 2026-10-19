import type { ModelRequest, Usage } from './model.ts';

export interface ModelPrice {
  /** USD per million tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /**
   * These prices hold only for prompts up to this many tokens (input, cache reads
   * and cache writes together); longer prompts cost more. The configuration refuses
   * per-call limits that could reach it.
   */
  maxPromptTokens?: number;
}

/**
 * Standard prices, USD per million tokens, with global routing and 5-minute
 * cache writes (the only kind this assistant makes). Verified on 2026-10-19 from
 * Anthropic's pricing page for the Claude API and from the AWS Price List API
 * (AmazonBedrockFoundationModels, eu-west-1) for Bedrock: the two agree. US-only
 * inference and regional Bedrock endpoints cost 10% more and aren't used.
 * Haiku 5.5 charges five times these prices for prompts over 100,000 tokens.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, maxPromptTokens: 100_000 },
};

export function costOf(usage: Usage, price: ModelPrice): number {
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.cacheWrite) /
    1_000_000
  );
}

/** A deliberately generous token estimate (≈3 characters per token) for budgeting before a call. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export const estimateRequestTokens = (request: ModelRequest): number =>
  estimateTokens(JSON.stringify([request.system, request.tools, request.messages]));

/** The most one call could cost with `inputTokens` of input: every token at the dearer of input and cache-write prices, plus a full output. */
export function worstCaseCallCost(inputTokens: number, maxOutputTokens: number, price: ModelPrice): number {
  return (inputTokens * Math.max(price.input, price.cacheWrite) + maxOutputTokens * price.output) / 1_000_000;
}

export interface AnswerLimits {
  maxRounds: number;
  maxOutputTokens: number;
  /** The chat loop refuses any call whose input could exceed this. Output tokens include thinking. */
  maxInputTokensPerCall: number;
}

/**
 * The most a single answer can cost: every allowed call at its largest
 * permitted input and full output, at the worst price. The chat loop enforces
 * each of these limits, so this is the amount to reserve from the budget.
 */
export function maxAnswerCost(price: ModelPrice, limits: AnswerLimits): number {
  return limits.maxRounds * worstCaseCallCost(limits.maxInputTokensPerCall, limits.maxOutputTokens, price);
}
