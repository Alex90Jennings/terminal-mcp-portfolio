import type Anthropic from '@anthropic-ai/sdk';
import type { ChatModel, ContentPart, ModelEvent, ModelMessage, ModelRequest, StopReason } from './model.ts';

/** Anything with the Messages API: `Anthropic` (Claude API) or `AnthropicBedrockMantle` (Amazon Bedrock). */
export interface MessagesClient {
  messages: Pick<Anthropic['messages'], 'stream'>;
}

export type Effort = 'low' | 'medium' | 'high';

/**
 * Claude through the Messages API. The same adapter serves the Claude API and
 * Amazon Bedrock: only the client and the model id differ.
 *
 * Within a turn, every assistant block (thinking, text, tool use) is replayed
 * exactly as received, because current models bind thinking blocks to the
 * conversation that produced them. Across turns the chat loop sends text only.
 */
export class ClaudeModel implements ChatModel {
  constructor(
    private readonly client: MessagesClient,
    /** The model id as the provider names it, e.g. "claude-opus-5-5" or "anthropic.claude-opus-5-5". */
    readonly id: string,
    private readonly options: { effort: Effort },
  ) {}

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const stream = this.client.messages.stream(
      {
        model: this.id,
        max_tokens: request.maxOutputTokens,
        // Tools render before the system prompt, so one breakpoint here caches both.
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
        })),
        messages: request.messages.map(toParam),
        output_config: { effort: this.options.effort },
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text', delta: event.delta.text };
      }
    }
    const message = await stream.finalMessage();
    yield {
      type: 'end',
      stopReason: toStopReason(message.stop_reason),
      content: message.content.map(fromBlock),
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

function toStopReason(reason: Anthropic.Message['stop_reason']): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'tool_use':
    case 'max_tokens':
    case 'refusal':
      return reason;
    default:
      return 'other';
  }
}

function fromBlock(block: Anthropic.ContentBlock): ContentPart {
  if (block.type === 'text') return { type: 'text', text: block.text, raw: block };
  if (block.type === 'tool_use') return { type: 'tool_call', id: block.id, name: block.name, input: block.input, raw: block };
  return { type: 'opaque', raw: block };
}

function toParam(message: ModelMessage): Anthropic.MessageParam {
  return {
    role: message.role,
    content: message.content.map((part): Anthropic.ContentBlockParam => {
      switch (part.type) {
        case 'text':
          return (part.raw as Anthropic.TextBlockParam | undefined) ?? { type: 'text', text: part.text };
        case 'tool_call':
          return (part.raw as Anthropic.ToolUseBlockParam | undefined) ?? {
            type: 'tool_use',
            id: part.id,
            name: part.name,
            input: part.input,
          };
        case 'tool_result':
          return { type: 'tool_result', tool_use_id: part.callId, content: part.content, is_error: part.isError };
        case 'opaque':
          return part.raw as Anthropic.ContentBlockParam;
      }
    }),
  };
}
