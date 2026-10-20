import { describe, expect, it } from 'vitest';
import { toolLabel } from '../src/chat.ts';
import type { ModelRequest } from '../src/model.ts';
import { SYSTEM_PROMPT } from '../src/prompt.ts';
import { demoScript, type Script } from '../src/scripted.ts';
import { chat } from './helpers.ts';

/** Calls one tool, then answers with the given text. */
const lookupThenAnswer =
  (name: string, input: unknown, answer: string): Script =>
  (_request, call) =>
    call === 0 ? { toolCalls: [{ name, input }] } : { text: answer };

describe('runChat', () => {
  it('answers through the real MCP tools and streams the text', async () => {
    const { outcome, events, text } = await chat(
      lookupThenAnswer('get_project', { project: 'clash', sections: ['overview'] }, 'Clash of Langs runs 24 language runtimes in Docker.'),
    );
    expect(outcome.stop).toBe('complete');
    expect(outcome.rounds).toBe(2);
    expect(outcome.toolCalls).toEqual([{ name: 'get_project', isError: false }]);
    expect(text).toBe('Clash of Langs runs 24 language runtimes in Docker.');
    expect(outcome.answer).toBe(text);
    expect(events).toContainEqual({ type: 'tool', name: 'get_project', label: 'get_project: clash (overview)', status: 'running' });
    expect(events).toContainEqual({ type: 'tool', name: 'get_project', label: 'get_project: clash (overview)', status: 'done' });
  });

  it('attributes sources from the tool results actually used, not from the model', async () => {
    const { outcome } = await chat(lookupThenAnswer('get_project', { project: 'operafy', sections: ['decisions'] }, 'Operafy uses OIDC.'));
    expect(outcome.sources.map(({ label }) => label)).toEqual(expect.arrayContaining(['operafy-infra README']));
    expect(outcome.sources.every(({ label }) => label.length > 0)).toBe(true);
    expect(outcome.projects).toEqual([{ id: 'operafy', name: 'Operafy' }]);
  });

  it('gives the model the system prompt, the MCP tool list and the question', async () => {
    let seen: ModelRequest | undefined;
    await chat((request) => {
      seen = request;
      return { text: 'ok' };
    });
    expect(seen?.system).toBe(SYSTEM_PROMPT);
    expect(seen?.tools.map(({ name }) => name)).toEqual([
      'list_projects', 'get_project', 'search_projects', 'get_profile', 'get_experience', 'get_skills', 'get_examples',
    ]);
    expect(seen?.tools.find(({ name }) => name === 'get_project')?.inputSchema).toMatchObject({ required: ['project'] });
    expect(seen?.messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'text', text: 'Which project best demonstrates Docker?' }] });
  });

  it('sends earlier turns as plain text only', async () => {
    let seen: ModelRequest | undefined;
    await chat(
      (request) => {
        seen = request;
        return { text: 'It uses Terraform.' };
      },
      { history: [{ role: 'user', text: 'Tell me about Operafy' }, { role: 'assistant', text: 'Operafy streams opera.' }], question: 'What about its infrastructure?' },
    );
    expect(seen?.messages.map(({ role, content }) => [role, content.map((part) => part.type)])).toEqual([
      ['user', ['text']],
      ['assistant', ['text']],
      ['user', ['text']],
    ]);
  });

  it('passes tool errors back so the model can recover', async () => {
    const results: string[] = [];
    const { outcome } = await chat((request, call) => {
      const last = request.messages.at(-1)?.content.find((part) => part.type === 'tool_result');
      if (last?.type === 'tool_result') results.push(`${last.isError}:${last.content}`);
      if (call === 0) return { toolCalls: [{ name: 'get_project', input: { project: 'clash-of-lang' } }] };
      if (call === 1) return { toolCalls: [{ name: 'get_project', input: { project: 'clash-of-langs', sections: ['overview'] } }] };
      return { text: 'Found it.' };
    });
    expect(results[0]).toMatch(/^true:No project matches "clash-of-lang"\. Did you mean clash-of-langs\?/);
    expect(results[1]).toMatch(/^false:\{/);
    expect(outcome.toolCalls).toEqual([
      { name: 'get_project', isError: true },
      { name: 'get_project', isError: false },
    ]);
    expect(outcome.stop).toBe('complete');
  });

  it('runs parallel tool calls and returns every result in one message', async () => {
    let toolResults = 0;
    await chat((request, call) => {
      if (call === 0) return { toolCalls: [{ name: 'get_profile', input: {} }, { name: 'get_skills', input: { category: 'ai' } }] };
      toolResults = request.messages.at(-1)?.content.filter((part) => part.type === 'tool_result').length ?? 0;
      return { text: 'done' };
    });
    expect(toolResults).toBe(2);
  });

  it('stops at the round limit and says so', async () => {
    const { outcome, events } = await chat(() => ({ toolCalls: [{ name: 'list_projects', input: {} }] }), { maxRounds: 3 });
    expect(outcome.stop).toBe('round_limit');
    expect(outcome.rounds).toBe(3);
    expect(events.at(-1)).toMatchObject({ type: 'notice', message: expect.stringMatching(/couldn’t finish/) });
  });

  it('never starts a model call that could exceed the cost ceiling', async () => {
    const { outcome } = await chat(() => ({ toolCalls: [{ name: 'list_projects', input: {} }] }), { maxCostUsd: 0.06, maxRounds: 10 });
    expect(outcome.stop).toBe('cost_limit');
    expect(outcome.costUsd).toBeLessThanOrEqual(0.06);
    expect(outcome.rounds).toBeGreaterThanOrEqual(1);
  });

  it('refuses to start at all when even one call could exceed the ceiling', async () => {
    const { outcome } = await chat(() => ({ text: 'unreachable' }), { maxCostUsd: 0.0001 });
    expect(outcome).toMatchObject({ stop: 'cost_limit', rounds: 0, costUsd: 0, answer: '' });
  });

  it.each([
    ['max_tokens', /cut short/],
    ['refusal', /can’t help/],
  ] as const)('reports a %s stop with a notice', async (stopReason, notice) => {
    const { outcome, events } = await chat(() => ({ text: 'Partial', stopReason }));
    expect(outcome.stop).toBe(stopReason);
    expect(events.at(-1)).toMatchObject({ type: 'notice', message: expect.stringMatching(notice) });
  });

  it('stops cleanly when cancelled', async () => {
    const controller = new AbortController();
    const { outcome } = await chat(
      () => {
        controller.abort();
        return { text: 'a long answer that will not be finished' };
      },
      { signal: controller.signal },
    );
    expect(outcome.stop).toBe('aborted');
    expect(outcome.error).toBeUndefined();
  });

  it('reports a failing model as an error, keeping the cause for logs only', async () => {
    const { outcome } = await chat(() => {
      throw new Error('provider exploded');
    });
    expect(outcome.stop).toBe('error');
    expect(String(outcome.error)).toContain('provider exploded');
  });

  it('stops before a call whose input could exceed the per-call token cap', async () => {
    const { outcome } = await chat(() => ({ toolCalls: [{ name: 'get_project', input: { project: 'zim' } }] }), { maxInputTokensPerCall: 9_000, maxRounds: 10 });
    expect(outcome.stop).toBe('cost_limit');
    expect(outcome.rounds).toBeGreaterThanOrEqual(1);
  });

  it('accounts for every round’s usage and cost', async () => {
    const { outcome } = await chat(lookupThenAnswer('list_projects', {}, 'Six projects.'));
    expect(outcome.usage.inputTokens).toBeGreaterThan(0);
    expect(outcome.costUsd).toBeGreaterThan(0);
  });
});

describe('demo script', () => {
  it('searches with the question, then answers in the matched project’s own words', async () => {
    const { outcome } = await chat(demoScript, { question: 'Which project best demonstrates Terraform?' });
    expect(outcome.toolCalls).toEqual([{ name: 'search_projects', isError: false }]);
    expect(outcome.answer).toMatch(/^The most relevant project is Operafy\./);
    expect(outcome.withheld).toEqual([]);
  });

  it('says when nothing is documented', async () => {
    const { outcome } = await chat(demoScript, { question: 'kubernetes helm charts' });
    expect(outcome.answer).toMatch(/isn’t documented/);
  });
});

describe('toolLabel', () => {
  it.each([
    ['get_project', { project: 'sol', sections: ['decisions', 'lessons'] }, 'get_project: sol (decisions, lessons)'],
    ['search_projects', { query: 'docker', limit: 3 }, 'search_projects: docker'],
    ['get_skills', { category: 'ai' }, 'get_skills: ai'],
    ['list_projects', {}, 'list_projects'],
  ])('%s %j → %s', (name, input, label) => expect(toolLabel(name, input)).toBe(label));
});
