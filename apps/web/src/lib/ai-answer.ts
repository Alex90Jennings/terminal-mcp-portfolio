import type { Block } from '@/terminal/output';
import type { ChatStreamEvent } from './chat-client';

type DoneEvent = Extract<ChatStreamEvent, { type: 'done' }>;

/** One AI answer in the terminal, as it streams in. */
export interface AiAnswer {
  status: 'waiting' | 'streaming' | 'done' | 'error' | 'cancelled' | 'unavailable';
  text: string;
  tools: { label: string; status: 'running' | 'done' | 'error' }[];
  notices: string[];
  sources: DoneEvent['sources'];
  projects: DoneEvent['projects'];
  /** STAR stories the answer told. */
  stories: DoneEvent['stories'];
  /** Why there is no answer, for `error` and `unavailable`. */
  message?: string;
  /** Local results shown when the assistant is unavailable. */
  fallback: Block[];
}

export const waitingAnswer = (fallback: Block[]): AiAnswer => ({
  status: 'waiting',
  text: '',
  tools: [],
  notices: [],
  sources: [],
  projects: [],
  stories: [],
  fallback,
});

export const isActive = (answer: AiAnswer): boolean => answer.status === 'waiting' || answer.status === 'streaming';

/** Applies one streamed event. Pure, so the terminal and its tests share it. */
export function applyChatEvent(answer: AiAnswer, event: ChatStreamEvent): AiAnswer {
  switch (event.type) {
    case 'text':
      return { ...answer, status: 'streaming', text: answer.text + event.delta };
    case 'tool': {
      const others = answer.tools.filter(({ label }) => label !== event.label);
      return { ...answer, tools: [...others, { label: event.label, status: event.status }] };
    }
    case 'notice':
      return answer.notices.includes(event.message) ? answer : { ...answer, notices: [...answer.notices, event.message] };
    case 'error':
      return { ...answer, status: 'error', message: event.message };
    case 'done':
      return {
        ...answer,
        status: answer.status === 'error' ? 'error' : 'done',
        // The server's copy is canonical: it is what the signed conversation records.
        text: event.answer,
        sources: event.sources,
        projects: event.projects,
        // Absent from servers that predate follow-ups.
        stories: event.stories ?? [],
      };
  }
}
