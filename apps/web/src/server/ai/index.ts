import { connectInProcess } from '@portfolio/mcp-server';
import { serverKb } from '../knowledge';
import { clientKey, createLimiter, type Limiter } from '../rate-limit';
import { createBudgetStore, type BudgetStore } from './budget';
import { resolveAiConfig, type AiConfig } from './config';
import { createChatHandler } from './handler';
import { createChatModel } from './provider';

// Built on first use, not at import, so `next build` never needs runtime secrets.
let budget: BudgetStore | undefined;
let limiters: { minute: Limiter; day: Limiter } | undefined;

export const chatHandler = createChatHandler({
  resolveConfig: () => resolveAiConfig(process.env),
  createModel: createChatModel,
  budget: (config: AiConfig) => (budget ??= createBudgetStore({ dailyUsd: config.dailyBudgetUsd, monthlyUsd: config.monthlyBudgetUsd })),
  limiters: (config: AiConfig) =>
    (limiters ??= {
      // AI costs money: both limits fail closed, with no configuration to change that.
      minute: createLimiter({ name: 'ai-minute', requests: config.questionsPerMinute, windowSeconds: 60, failureMode: 'closed' }),
      day: createLimiter({ name: 'ai-day', requests: config.questionsPerDay, windowSeconds: 86_400, failureMode: 'closed' }),
    }),
  clientKey,
  connectMcp: () =>
    connectInProcess(serverKb, {
      onError: (error, where) => console.error(JSON.stringify({ event: 'mcp.error', where, error: String(error) })),
    }),
  projects: serverKb.projects.map(({ id, name }) => ({ id, name })),
});
