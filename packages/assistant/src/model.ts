/*
 * The provider-neutral model interface. The chat loop only ever talks to a
 * `ChatModel`; adapters translate to a specific API. Switching providers is a
 * new adapter, not a change to the loop.
 */

export type ContentPart =
  | { type: 'text'; text: string; raw?: unknown }
  | { type: 'tool_call'; id: string; name: string; input: unknown; raw?: unknown }
  | { type: 'tool_result'; callId: string; content: string; isError: boolean }
  /** A provider-specific block (e.g. thinking) replayed verbatim within the same turn. */
  | { type: 'opaque'; raw: unknown };

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: ContentPart[];
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ModelRequest {
  system: string;
  messages: ModelMessage[];
  tools: ToolSpec[];
  maxOutputTokens: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export type ModelEvent =
  | { type: 'text'; delta: string }
  /** The complete assistant message, to append to the conversation, and what it cost. */
  | { type: 'end'; stopReason: StopReason; content: ContentPart[]; usage: Usage };

export interface ChatModel {
  /** The model identifier, for logs and pricing. */
  readonly id: string;
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}

export const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}
