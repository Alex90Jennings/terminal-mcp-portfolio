import { estimateTokens } from './cost.ts';
import type { ChatModel, ContentPart, ModelEvent, ModelMessage, ModelRequest, StopReason } from './model.ts';

/** One scripted model response. */
export interface ScriptStep {
  text?: string;
  toolCalls?: { name: string; input: unknown }[];
  stopReason?: StopReason;
}

export type Script = (request: ModelRequest, call: number) => ScriptStep;

/**
 * A deterministic stand-in for a real model: no network, no keys, no cost.
 * Used by every automated test and by local development without a provider.
 * It reports estimated token usage so budgets are exercised realistically.
 */
export class ScriptedModel implements ChatModel {
  private calls = 0;

  constructor(
    private readonly script: Script,
    readonly id = 'scripted',
    private readonly chunkSize = 24,
  ) {}

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const step = this.script(request, this.calls++);
    const text = step.text ?? '';
    for (let index = 0; index < text.length; index += this.chunkSize) {
      if (signal.aborted) throw signal.reason ?? new Error('aborted');
      await Promise.resolve();
      yield { type: 'text', delta: text.slice(index, index + this.chunkSize) };
    }
    const toolCalls = step.toolCalls ?? [];
    const content: ContentPart[] = [
      ...(text ? [{ type: 'text' as const, text }] : []),
      ...toolCalls.map((call, index) => ({ type: 'tool_call' as const, id: `call_${this.calls}_${index}`, name: call.name, input: call.input })),
    ];
    yield {
      type: 'end',
      stopReason: step.stopReason ?? (toolCalls.length > 0 ? 'tool_use' : 'end_turn'),
      content,
      usage: {
        inputTokens: estimateTokens(JSON.stringify([request.system, request.tools, request.messages])),
        outputTokens: estimateTokens(text + JSON.stringify(toolCalls)),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }
}

const lastUserText = (messages: readonly ModelMessage[]): string => {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const text = message?.role === 'user' ? message.content.find((part) => part.type === 'text') : undefined;
    if (text?.type === 'text') return text.text;
  }
  return '';
};

const lastToolResult = (messages: readonly ModelMessage[]): string | undefined => {
  const last = messages.at(-1);
  const result = last?.content.find((part) => part.type === 'tool_result');
  return result?.type === 'tool_result' ? result.content : undefined;
};

/**
 * A demo script for development without a provider: it searches the portfolio
 * with the visitor's question, then answers from the top result's own words.
 * Deterministic, grounded by construction, and clearly not an AI.
 */
export const demoScript: Script = (request) => {
  const result = lastToolResult(request.messages);
  if (result === undefined) {
    return { toolCalls: [{ name: 'search_projects', input: { query: lastUserText(request.messages).slice(0, 200), limit: 3 } }] };
  }
  try {
    const parsed = JSON.parse(result) as { results?: { projectName: string; matches: { text: string }[] }[] };
    const [top] = parsed.results ?? [];
    if (top === undefined) {
      return { text: 'That isn’t documented in the portfolio. Try `projects` to browse, or `contact` to ask Alex directly.' };
    }
    const evidence = top.matches[0]?.text ?? '';
    return { text: `The most relevant project is ${top.projectName}. ${evidence}`.trim() };
  } catch {
    return { text: 'I couldn’t read the portfolio data for that question. Try `projects` instead.' };
  }
};
