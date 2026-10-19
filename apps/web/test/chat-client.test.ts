import { describe, expect, it } from 'vitest';
import { applyChatEvent, isActive, waitingAnswer } from '@/lib/ai-answer';
import { parseSse, type ChatStreamEvent } from '@/lib/chat-client';
import { blocksToText } from '@/terminal/output';
import { output, run } from './helpers';

describe('parseSse', () => {
  const frame = (event: ChatStreamEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

  it('parses complete events and keeps the unfinished remainder', () => {
    const text = frame({ type: 'text', delta: 'Hello' }) + frame({ type: 'notice', message: 'n' }) + 'event: text\ndata: {"ty';
    const { events, rest } = parseSse(text);
    expect(events).toEqual([{ type: 'text', delta: 'Hello' }, { type: 'notice', message: 'n' }]);
    expect(rest).toBe('event: text\ndata: {"ty');
  });

  it('reassembles events split across chunks', () => {
    const whole = frame({ type: 'text', delta: 'Split' });
    const first = parseSse(whole.slice(0, 10));
    const second = parseSse(first.rest + whole.slice(10));
    expect([...first.events, ...second.events]).toEqual([{ type: 'text', delta: 'Split' }]);
  });

  it('skips malformed frames', () => {
    expect(parseSse('data: not json\n\n').events).toEqual([]);
  });
});

describe('applyChatEvent', () => {
  it('builds an answer from streamed events, ending with the server’s canonical text', () => {
    let answer = waitingAnswer([]);
    expect(isActive(answer)).toBe(true);
    for (const event of [
      { type: 'tool', name: 'get_project', label: 'get_project: sol', status: 'running' },
      { type: 'text', delta: 'SOL is ' },
      { type: 'tool', name: 'get_project', label: 'get_project: sol', status: 'done' },
      { type: 'text', delta: 'a wallpaper.' },
      { type: 'notice', message: 'Check the sources.' },
      { type: 'notice', message: 'Check the sources.' },
      {
        type: 'done',
        answer: 'SOL is a wallpaper.',
        stop: 'complete',
        sources: [{ label: 'SOL README' }],
        projects: [{ id: 'sol', name: 'SOL' }],
        withheldStatements: 0,
        conversation: { turns: [], issuedAt: 0, signature: 'v1.x' },
      },
    ] satisfies ChatStreamEvent[]) {
      answer = applyChatEvent(answer, event);
    }
    expect(answer).toMatchObject({
      status: 'done',
      text: 'SOL is a wallpaper.',
      tools: [{ label: 'get_project: sol', status: 'done' }],
      notices: ['Check the sources.'],
      sources: [{ label: 'SOL README' }],
      projects: [{ id: 'sol', name: 'SOL' }],
    });
    expect(isActive(answer)).toBe(false);
  });

  it('keeps an error status through the final done event', () => {
    let answer = applyChatEvent(waitingAnswer([]), { type: 'error', message: 'Problem.' });
    answer = applyChatEvent(answer, { type: 'done', answer: '', stop: 'error', sources: [], projects: [], withheldStatements: 0, conversation: { turns: [], issuedAt: 0, signature: 's' } });
    expect(answer).toMatchObject({ status: 'error', message: 'Problem.' });
  });
});

describe('questions and the ask command', () => {
  it('routes a question to the assistant when AI is enabled, keeping the local answer as fallback', () => {
    const result = run('Which project best demonstrates Docker?', { aiAvailable: true });
    expect(result.blocks).toEqual([]);
    expect(result.ask?.question).toBe('Which project best demonstrates Docker?');
    expect(blocksToText(result.ask?.fallback ?? [])).toContain('Clash of Langs');
  });

  it('answers locally when AI is disabled', () => {
    expect(run('Which project best demonstrates Docker?').ask).toBeUndefined();
  });

  it('ask sends its arguments as the question', () => {
    expect(run('ask what is sol', { aiAvailable: true }).ask?.question).toBe('what is sol');
  });

  it('ask without a question shows how to use it', () => {
    expect(output('ask', { aiAvailable: true })).toMatch(/^Usage: ask/);
  });

  it('commands never go to the assistant, even with AI enabled', () => {
    for (const command of ['help', 'projects', 'projects sol', 'sol', 'skills', 'contact', 'projcts']) {
      expect(run(command, { aiAvailable: true }).ask, command).toBeUndefined();
    }
  });
});
