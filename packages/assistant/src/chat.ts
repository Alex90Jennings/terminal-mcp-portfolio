import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { costOf, estimateRequestTokens, estimateTokens, worstCaseCallCost, type ModelPrice } from './cost.ts';
import { collectCitations, projectsMentioned, storiesTold, toPlainText, withDisplayNames, type Citation } from './evidence.ts';
import { RetrievalLedger } from './absence.ts';
import { SentenceGate, type Withheld } from './gate.ts';
import { addUsage, NO_USAGE, type ChatModel, type ContentPart, type ModelMessage, type ModelRequest, type ToolSpec, type Usage } from './model.ts';
import { SYSTEM_PROMPT } from './prompt.ts';
import type { TranscriptTurn } from './transcript.ts';

export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; label: string; status: 'running' | 'done' | 'error' }
  | { type: 'notice'; message: string };

export type ChatStop =
  | 'complete'
  | 'max_tokens'
  | 'refusal'
  /** Stopped before another model call to stay within the tool-round limit. */
  | 'round_limit'
  /** Stopped before a model call whose input or cost could exceed this answer's limits. */
  | 'cost_limit'
  | 'aborted'
  | 'error';

export interface ChatOptions {
  model: ChatModel;
  price: ModelPrice;
  /** A connected MCP client: the assistant's only source of facts. */
  mcp: Client;
  /** Earlier turns: conversational context only, never evidence. */
  history: readonly TranscriptTurn[];
  question: string;
  projects: readonly { id: string; name: string }[];
  maxRounds: number;
  maxOutputTokens: number;
  /** No call may start whose input could exceed this many tokens. */
  maxInputTokensPerCall: number;
  /** The most this answer may cost; the amount reserved from the budget. */
  maxCostUsd: number;
  signal: AbortSignal;
  onEvent: (event: ChatEvent) => void;
}

export interface ChatOutcome {
  /** The answer exactly as the visitor saw it: withheld sentences are not part of it. */
  answer: string;
  stop: ChatStop;
  usage: Usage;
  costUsd: number;
  rounds: number;
  toolCalls: { name: string; isError: boolean }[];
  sources: Citation[];
  projects: { id: string; name: string }[];
  /** The examples (STAR stories) this turn retrieved that the answer tells. */
  stories: { id: string; title: string }[];
  /** Sentences never shown because their figures weren't in this turn's tool results. */
  withheld: Withheld[];
  /** Set when `stop` is "error": the underlying failure, for server logs only. */
  error?: unknown;
}

const NOTICES: Partial<Record<ChatStop, string>> = {
  max_tokens: 'The answer was cut short. Ask a narrower question for the rest.',
  refusal: 'I can’t help with that one. Try `/help` to see what I can do.',
  round_limit: 'I couldn’t finish looking that up. Try a more specific question.',
  cost_limit: 'That question needed more lookups than one answer allows. Try a more specific question.',
};

export const withheldNotice = (count: number): string =>
  `${count === 1 ? 'One statement was' : `${count} statements were`} withheld because ${count === 1 ? 'its figures' : 'their figures'} couldn’t be matched to the portfolio data. ` +
  'This check covers numbers only, so please rely on the sources below.';

export const leakNotice = (count: number): string =>
  `${count === 1 ? 'One statement was' : `${count} statements were`} withheld because ${count === 1 ? 'it' : 'they'} repeated internal configuration. ` +
  'Ask about Alex’s work instead.';

export const absenceNotice = (count: number): string =>
  `${count === 1 ? 'One statement was' : `${count} statements were`} withheld because ${count === 1 ? 'it' : 'they'} said the portfolio doesn’t record something ` +
  'before the whole project had been checked. Ask about that detail directly for a full lookup.';

/**
 * One visitor question, answered from the portfolio's MCP tools. The model may
 * call tools for up to `maxRounds` rounds. Text reaches the visitor through a
 * sentence gate that withholds any sentence whose figures this turn's tool
 * results don't contain. Sources come from those results, not the model's text.
 */
export async function runChat(options: ChatOptions): Promise<ChatOutcome> {
  const { model, mcp, signal, onEvent } = options;
  const tools: ToolSpec[] = (await mcp.listTools()).tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema as Record<string, unknown>,
  }));

  const messages: ModelMessage[] = [
    ...options.history.map((turn): ModelMessage => ({ role: turn.role, content: [{ type: 'text', text: turn.text }] })),
    { role: 'user', content: [{ type: 'text', text: options.question }] },
  ];

  // Evidence is this turn's successful tool results only: never the question or earlier turns.
  const evidence: string[] = [];
  const results: unknown[] = [];
  const displayNames = withDisplayNames(options.projects);
  // Full records for the absence check only: never evidence, never sent to the model.
  const records = new Map<string, Readonly<Record<string, unknown>>>();
  const examples = new Map<string, string[]>();
  await Promise.all(
    options.projects.map(async ({ id }) => {
      const full = await callTool(mcp, 'get_project', { project: id });
      const structured = full.structured as { project?: Record<string, unknown>; examples?: { id: string }[] } | undefined;
      if (full.isError || structured?.project === undefined) return;
      records.set(id, structured.project);
      examples.set(id, (structured.examples ?? []).map((example) => example.id));
    }),
  );
  const ledger = new RetrievalLedger(options.projects, records, examples);
  const gate = new SentenceGate(
    () => evidence,
    (text) => onEvent({ type: 'text', delta: text }),
    (text) => toPlainText(displayNames(text)),
    (sentence, released) => ledger.check(sentence, released),
  );

  let usage = NO_USAGE;
  let rounds = 0;
  let stop: ChatStop = 'complete';
  let error: unknown;
  // Real token counts calibrate the next call's input estimate once the model has reported them.
  let calibrated: { input: number; newSince: string } | undefined;
  const toolCalls: ChatOutcome['toolCalls'] = [];
  const spent = () => costOf(usage, options.price);

  try {
    for (;;) {
      if (rounds >= options.maxRounds) {
        stop = 'round_limit';
        break;
      }
      // A snapshot: the loop appends to `messages` afterwards, and a model must never see that.
      const request: ModelRequest = { system: SYSTEM_PROMPT, messages: [...messages], tools, maxOutputTokens: options.maxOutputTokens };
      const inputTokens = Math.max(estimateRequestTokens(request), calibrated ? calibrated.input + estimateTokens(calibrated.newSince) : 0);
      if (
        inputTokens > options.maxInputTokensPerCall ||
        spent() + worstCaseCallCost(inputTokens, options.maxOutputTokens, options.price) > options.maxCostUsd
      ) {
        stop = 'cost_limit';
        break;
      }
      rounds += 1;

      let end: { stopReason: string; content: ContentPart[]; usage: Usage } | undefined;
      for await (const event of model.stream(request, signal)) {
        if (event.type === 'text') gate.push(event.delta);
        else end = event;
      }
      if (end === undefined) throw new Error('model stream ended without a final message');
      usage = addUsage(usage, end.usage);
      gate.flush();
      messages.push({ role: 'assistant', content: end.content });

      if (end.stopReason !== 'tool_use') {
        stop = end.stopReason === 'max_tokens' ? 'max_tokens' : end.stopReason === 'refusal' ? 'refusal' : 'complete';
        break;
      }

      const calls = end.content.filter((part) => part.type === 'tool_call');
      const toolResults: ContentPart[] = [];
      // Parallel calls run together and their results go back in one message.
      await Promise.all(
        calls.map(async (call, index) => {
          const label = toolLabel(call.name, call.input);
          onEvent({ type: 'tool', name: call.name, label, status: 'running' });
          // A partial project record also brings the omitted passages that bear on the question, and examples follow the
          // competency the visitor named, not the model's paraphrase of it.
          const input =
            (call.name === 'get_project' || call.name === 'get_examples') && typeof call.input === 'object' && call.input !== null
              ? { relatedTo: options.question.slice(0, 500), ...(call.input as Record<string, unknown>) }
              : call.input;
          const result = await callTool(mcp, call.name, input);
          toolCalls.push({ name: call.name, isError: result.isError });
          onEvent({ type: 'tool', name: call.name, label, status: result.isError ? 'error' : 'done' });
          if (!result.isError) {
            results.push(result.structured);
            evidence.push(result.text);
            ledger.record(call.name, result.structured);
          }
          toolResults[index] = { type: 'tool_result', callId: call.id, content: result.text, isError: result.isError };
        }),
      );
      messages.push({ role: 'user', content: toolResults });
      calibrated = {
        input: end.usage.inputTokens + end.usage.cacheReadTokens + end.usage.cacheWriteTokens + end.usage.outputTokens,
        newSince: JSON.stringify(toolResults),
      };

      // Separate text from successive rounds so streamed sentences don't run together.
      if (gate.text !== '' && !gate.text.endsWith('\n')) gate.push('\n');
    }
  } catch (caught) {
    stop = signal.aborted ? 'aborted' : 'error';
    if (stop === 'error') error = caught;
  }
  // Whatever is still held is checked like everything else; nothing unchecked is released.
  if (!signal.aborted) gate.flush();

  const notice = NOTICES[stop];
  if (notice !== undefined) onEvent({ type: 'notice', message: notice });
  const leaks = gate.withheld.filter(({ leak }) => leak !== undefined).length;
  const absences = gate.withheld.filter(({ project }) => project !== undefined).length;
  const figures = gate.withheld.length - absences - leaks;
  if (figures > 0) onEvent({ type: 'notice', message: withheldNotice(figures) });
  if (absences > 0) onEvent({ type: 'notice', message: absenceNotice(absences) });
  if (leaks > 0) onEvent({ type: 'notice', message: leakNotice(leaks) });

  const answer = gate.text.trim();
  return {
    answer,
    stop,
    usage,
    costUsd: spent(),
    rounds,
    toolCalls,
    sources: collectCitations(results),
    projects: projectsMentioned(answer, options.projects).map(({ id, name }) => ({ id, name })),
    stories: storiesTold(
      answer,
      results.flatMap((result) => {
        const examples = (result as { examples?: unknown } | undefined)?.examples;
        return Array.isArray(examples) ? (examples as Parameters<typeof storiesTold>[1]) : [];
      }),
    ),
    withheld: gate.withheld,
    ...(error !== undefined && { error }),
  };
}

async function callTool(mcp: Client, name: string, input: unknown): Promise<{ isError: boolean; text: string; structured: unknown }> {
  try {
    const result = (await mcp.callTool({ name, arguments: (input ?? {}) as Record<string, unknown> })) as CallToolResult;
    const text = result.structuredContent
      ? JSON.stringify(result.structuredContent)
      : result.content.map((item) => (item.type === 'text' ? item.text : '')).join('\n');
    return { isError: result.isError === true, text, structured: result.structuredContent };
  } catch {
    return { isError: true, text: `The ${name} tool could not run. Try a different tool or arguments.`, structured: undefined };
  }
}

/** A short, human label for a tool call, e.g. "get_project: sol (decisions)". */
export function toolLabel(name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const main = [args.project, args.query, args.category].find((value) => typeof value === 'string') as string | undefined;
  const sections = Array.isArray(args.sections) ? ` (${args.sections.join(', ')})` : '';
  return main ? `${name}: ${main.slice(0, 60)}${sections}` : name;
}
