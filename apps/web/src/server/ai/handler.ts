import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  PROMPT_VERSION,
  runChat,
  signTranscript,
  TRANSCRIPT_LIMITS,
  trimTranscript,
  verifyTranscript,
  type ChatModel,
  type ChatOutcome,
  type SignedTranscript,
  type TranscriptTurn,
} from '@portfolio/assistant';
import { z } from 'zod';
import { cleanInput } from '@/lib/clean-input';
import type { Limiter } from '../rate-limit';
import { toMicros, type BudgetStore } from './budget';
import type { AiConfig, AiConfigResult } from './config';

export const MAX_QUESTION_CHARS = 500;
const MAX_BODY_BYTES = 64 * 1024;

const RequestSchema = z.strictObject({
  // Cleaned before the length check, so control or invisible characters can't pad a question past it or hide in it.
  question: z.string().max(MAX_QUESTION_CHARS * 4).transform(cleanInput).pipe(z.string().min(1).max(MAX_QUESTION_CHARS)),
  conversation: z
    .strictObject({
      turns: z
        .array(z.strictObject({ role: z.enum(['user', 'assistant']), text: z.string().max(TRANSCRIPT_LIMITS.maxTurnChars) }))
        .max(TRANSCRIPT_LIMITS.maxTurns),
      issuedAt: z.number().int().nonnegative(),
      signature: z.string().max(200),
    })
    .optional(),
});

/** What the terminal receives, as server-sent events, while an answer streams. */
export type ChatStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; label: string; status: 'running' | 'done' | 'error' }
  | { type: 'notice'; message: string }
  | {
      type: 'done';
      answer: string;
      stop: ChatOutcome['stop'];
      sources: ChatOutcome['sources'];
      projects: ChatOutcome['projects'];
      /** STAR stories the answer told, for follow-ups. */
      stories: ChatOutcome['stories'];
      /** Sentences never shown because their figures weren't in this turn's tool results. */
      withheldStatements: number;
      conversation: SignedTranscript;
    }
  | { type: 'error'; message: string };

/** Refusals before streaming starts, as JSON. */
export type ChatRefusal = { error: 'ai_unavailable' | 'budget_exhausted' | 'rate_limited' | 'bad_request' | 'forbidden'; message: string };

export interface ChatDeps {
  resolveConfig: () => AiConfigResult;
  createModel: (config: AiConfig) => ChatModel;
  budget: (config: AiConfig) => BudgetStore;
  limiters: (config: AiConfig) => { minute: Limiter; day: Limiter };
  clientKey: (request: Request) => Promise<string>;
  connectMcp: () => Promise<Client>;
  projects: readonly { id: string; name: string }[];
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
  /**
   * Receives each answer's full outcome, including any withheld sentences. For
   * the offline evaluation only: production leaves it unset, so withheld text is
   * never logged or sent anywhere.
   */
  inspect?: (outcome: ChatOutcome) => void;
}

const MESSAGES = {
  unavailable: 'The AI assistant isn’t available right now. Commands like `projects` and `skills` still work.',
  budget: 'The AI assistant has reached its spending limit for now. Commands like `projects` and `skills` still work, and the assistant will be back soon.',
  rateLimited: 'That’s a lot of questions in a short time. Please wait a moment, or browse with `projects` meanwhile.',
  failed: 'The AI assistant ran into a problem answering that. Please try again.',
  historyReset: 'Earlier messages couldn’t be verified, so this answer starts a fresh conversation.',
  historyExpired: 'This conversation has expired, so this answer starts a fresh one.',
  demo: 'Demo mode: this answer comes from a scripted search of the portfolio, not from an AI model.',
} as const;

function refuse(status: number, body: ChatRefusal, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

/** The chat endpoint is for this site's terminal only: same-origin requests, no CORS. */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== null && fetchSite !== 'same-origin') return false;
  if (origin === null) return false;
  try {
    return new URL(origin).host === (request.headers.get('host') ?? new URL(request.url).host);
  } catch {
    return false;
  }
}

async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return null;
  const text = await request.text();
  return new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES ? null : text;
}

export function createChatHandler(deps: ChatDeps): (request: Request) => Promise<Response> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((event) => console.log(JSON.stringify(event)));

  return async (request) => {
    if (request.method !== 'POST') return refuse(405, { error: 'bad_request', message: 'Use POST.' }, { Allow: 'POST' });
    if (!isSameOrigin(request)) return refuse(403, { error: 'forbidden', message: 'This endpoint serves the portfolio terminal only.' });
    if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      return refuse(415, { error: 'bad_request', message: 'Content-Type must be application/json.' });
    }
    const text = await readBody(request);
    if (text === null) return refuse(413, { error: 'bad_request', message: 'Request too large.' });
    let parsed: z.infer<typeof RequestSchema>;
    try {
      parsed = RequestSchema.parse(JSON.parse(text));
    } catch {
      return refuse(400, { error: 'bad_request', message: `Questions must be 1–${MAX_QUESTION_CHARS} characters.` });
    }

    const resolved = deps.resolveConfig();
    if (!resolved.ok) {
      log({ event: 'ai.unavailable', reason: resolved.reason });
      return refuse(503, { error: 'ai_unavailable', message: MESSAGES.unavailable });
    }
    const config = resolved.config;

    // Rate limits: always fail closed for AI, whatever MCP is configured to do.
    const key = await deps.clientKey(request);
    const limiters = deps.limiters(config);
    for (const limiter of [limiters.minute, limiters.day]) {
      const outcome = await limiter(key);
      if (!outcome.ok) {
        if (outcome.status === 503) return refuse(503, { error: 'ai_unavailable', message: MESSAGES.unavailable });
        return refuse(429, { error: 'rate_limited', message: MESSAGES.rateLimited }, { 'Retry-After': String(outcome.retryAfterSeconds) });
      }
    }

    // Reserve this answer's worst case before any model call; settle to the actual cost afterwards.
    const budget = deps.budget(config);
    const reserved = await budget.reserve(toMicros(config.maxCostPerAnswerUsd), now());
    if (!reserved.ok) {
      log({ event: 'ai.budget.refused', reason: reserved.reason });
      return reserved.reason === 'unavailable'
        ? refuse(503, { error: 'ai_unavailable', message: MESSAGES.unavailable })
        : refuse(503, { error: 'budget_exhausted', message: MESSAGES.budget });
    }

    // History is conversational context only: it is never evidence, and the chat loop never treats it as such.
    const submitted = parsed.conversation;
    const historyCheck = submitted === undefined ? undefined : await verifyTranscript(submitted, config.transcriptSecret, now().getTime());
    const history: TranscriptTurn[] = submitted !== undefined && historyCheck?.ok ? trimTranscript(submitted.turns) : [];

    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, request.signal, AbortSignal.timeout(config.timeoutMs)]);
    const started = performance.now();
    const encoder = new TextEncoder();

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: ChatStreamEvent) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
          } catch {
            // The visitor has gone; the abort signal stops the work.
          }
        };
        let outcome: ChatOutcome | undefined;
        let mcp: Client | undefined;
        try {
          if (config.provider === 'scripted') send({ type: 'notice', message: MESSAGES.demo });
          if (historyCheck !== undefined && !historyCheck.ok) {
            send({ type: 'notice', message: historyCheck.reason === 'expired' ? MESSAGES.historyExpired : MESSAGES.historyReset });
          }
          mcp = await deps.connectMcp();
          outcome = await runChat({
            model: deps.createModel(config),
            price: config.price,
            mcp,
            history,
            question: parsed.question,
            projects: deps.projects,
            maxRounds: config.maxRounds,
            maxOutputTokens: config.maxOutputTokens,
            maxInputTokensPerCall: config.maxInputTokensPerCall,
            maxCostUsd: config.maxCostPerAnswerUsd,
            signal,
            onEvent: send,
          });

          if (outcome.stop === 'error') send({ type: 'error', message: MESSAGES.failed });

          const answered = outcome.answer !== '' && (outcome.stop === 'complete' || outcome.stop === 'max_tokens');
          const turns = answered
            ? trimTranscript([...history, { role: 'user', text: parsed.question }, { role: 'assistant', text: outcome.answer }])
            : history;
          send({
            type: 'done',
            answer: outcome.answer,
            stop: outcome.stop,
            sources: outcome.sources,
            projects: outcome.projects,
            stories: outcome.stories,
            withheldStatements: outcome.withheld.length,
            conversation: await signTranscript(turns, config.transcriptSecret, now().getTime()),
          });
        } catch (error) {
          send({ type: 'error', message: MESSAGES.failed });
          log({ event: 'ai.failed', where: 'stream', errorType: error instanceof Error ? error.name : typeof error });
        } finally {
          await budget.settle(reserved.reservation, toMicros(outcome?.costUsd ?? 0));
          await mcp?.close().catch(() => {});
          if (outcome !== undefined) deps.inspect?.(outcome);
          log({
            event: 'ai.answer',
            model: config.model,
            provider: config.provider,
            promptVersion: PROMPT_VERSION,
            stop: outcome?.stop ?? 'error',
            rounds: outcome?.rounds ?? 0,
            tools: outcome?.toolCalls.map(({ name, isError }) => (isError ? `${name}!` : name)) ?? [],
            usage: outcome?.usage,
            costUsd: outcome?.costUsd ?? 0,
            reservedUsd: config.maxCostPerAnswerUsd,
            withheldStatements: outcome?.withheld.length ?? 0,
            historyTurns: history.length,
            ...(historyCheck !== undefined && !historyCheck.ok && { historyRejected: historyCheck.reason }),
            durationMs: Math.round(performance.now() - started),
            ...(outcome?.error !== undefined && { errorType: outcome.error instanceof Error ? outcome.error.name : typeof outcome.error }),
          });
          try {
            controller.close();
          } catch {
            // Already closed by the client.
          }
        }
      },
      cancel() {
        abort.abort();
      },
    });

    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      },
    });
  };
}
