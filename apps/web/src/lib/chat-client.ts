import type { ChatRefusal, ChatStreamEvent } from '@/server/ai/handler';

export type { ChatStreamEvent };

/** The signed conversation exactly as the server returned it; sent back unchanged. */
export interface Conversation {
  turns: { role: 'user' | 'assistant'; text: string }[];
  issuedAt: number;
  signature: string;
}

/** The server declined before answering (AI off, budget reached, rate limited, …). */
export class ChatRefused extends Error {
  constructor(
    readonly code: ChatRefusal['error'] | 'network',
    message: string,
  ) {
    super(message);
    this.name = 'ChatRefused';
  }
}

/** Splits server-sent event text into complete events, returning any unfinished remainder. */
export function parseSse(buffer: string): { events: ChatStreamEvent[]; rest: string } {
  const frames = buffer.split('\n\n');
  const rest = frames.pop() ?? '';
  const events = frames.flatMap((frame) => {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data === '') return [];
    try {
      return [JSON.parse(data) as ChatStreamEvent];
    } catch {
      return [];
    }
  });
  return { events, rest };
}

const NETWORK_MESSAGE = 'The AI assistant couldn’t be reached. Commands like `/projects` still work.';

/** Asks the assistant and reports each streamed event. Throws `ChatRefused` if it declines up front. */
export async function streamChat(options: {
  question: string;
  conversation: Conversation | undefined;
  signal: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
  endpoint?: string;
}): Promise<void> {
  let response: Response;
  try {
    response = await fetch(options.endpoint ?? '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ question: options.question, ...(options.conversation && { conversation: options.conversation }) }),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal.aborted) throw error;
    throw new ChatRefused('network', NETWORK_MESSAGE);
  }

  if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('text/event-stream') || response.body === null) {
    const refusal = (await response.json().catch(() => null)) as ChatRefusal | null;
    throw new ChatRefused(refusal?.error ?? 'ai_unavailable', refusal?.message ?? NETWORK_MESSAGE);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const parsed = parseSse(buffer + value);
    buffer = parsed.rest;
    parsed.events.forEach(options.onEvent);
  }
}
