import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { ClaudeModel, type MessagesClient } from '../src/claude.ts';
import { costOf, maxAnswerCost, MODEL_PRICES, worstCaseCallCost } from '../src/cost.ts';
import { checkGrounding, collectCitations, projectsMentioned } from '../src/evidence.ts';
import type { ModelEvent, ModelRequest } from '../src/model.ts';
import { signTranscript, TRANSCRIPT_LIMITS, trimTranscript, verifyTranscript, type TranscriptTurn } from '../src/transcript.ts';

describe('ClaudeModel', () => {
  const thinking = { type: 'thinking', thinking: '', signature: 'sig-abc' };
  const toolUse = { type: 'tool_use', id: 'toolu_1', name: 'get_project', input: { project: 'sol' } };
  const final = {
    content: [thinking, { type: 'text', text: 'Looking it up.', citations: null }, toolUse],
    stop_reason: 'tool_use',
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 },
  };

  function fakeClient() {
    const calls: { params: Anthropic.MessageStreamParams; signal: AbortSignal | undefined }[] = [];
    const client: MessagesClient = {
      messages: {
        stream: ((params: Anthropic.MessageStreamParams, options?: { signal?: AbortSignal }) => {
          calls.push({ params, signal: options?.signal });
          const events = [
            { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Looking ' } },
            { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'it up.' } },
          ];
          return {
            async *[Symbol.asyncIterator]() {
              yield* events;
            },
            finalMessage: async () => final,
          };
        }) as unknown as MessagesClient['messages']['stream'],
      },
    };
    return { client, calls };
  }

  const request: ModelRequest = {
    system: 'SYSTEM',
    tools: [{ name: 'get_project', description: 'Get a project', inputSchema: { type: 'object', properties: {} } }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'What is SOL?' }] }],
    maxOutputTokens: 1024,
  };

  async function collect(model: ClaudeModel, req: ModelRequest) {
    const events: ModelEvent[] = [];
    for await (const event of model.stream(req, new AbortController().signal)) events.push(event);
    return events;
  }

  it('sends a cached system prompt, the tools, low effort and the abort signal', async () => {
    const { client, calls } = fakeClient();
    await collect(new ClaudeModel(client, 'anthropic.claude-opus-5-5', { effort: 'low' }), request);
    const [{ params, signal } = { params: undefined, signal: undefined }] = calls;
    expect(params).toMatchObject({
      model: 'anthropic.claude-opus-5-5',
      max_tokens: 1024,
      system: [{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }],
      tools: [{ name: 'get_project', description: 'Get a project', input_schema: { type: 'object', properties: {} } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'What is SOL?' }] }],
      output_config: { effort: 'low' },
    });
    // Thinking is left to the model's default (adaptive): Opus 5.5 rejects any other setting.
    expect(params).not.toHaveProperty('thinking');
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('streams text deltas, then the full message, usage and stop reason', async () => {
    const { client } = fakeClient();
    const events = await collect(new ClaudeModel(client, 'claude-opus-5-5', { effort: 'low' }), request);
    expect(events.slice(0, 2)).toEqual([{ type: 'text', delta: 'Looking ' }, { type: 'text', delta: 'it up.' }]);
    expect(events[2]).toMatchObject({
      type: 'end',
      stopReason: 'tool_use',
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 3000, cacheWriteTokens: 0 },
      content: [{ type: 'opaque' }, { type: 'text', text: 'Looking it up.' }, { type: 'tool_call', id: 'toolu_1', name: 'get_project', input: { project: 'sol' } }],
    });
  });

  it('replays every assistant block verbatim within a turn, thinking included', async () => {
    const { client, calls } = fakeClient();
    const model = new ClaudeModel(client, 'claude-opus-5-5', { effort: 'low' });
    const [, , end] = await collect(model, request);
    if (end?.type !== 'end') throw new Error('expected an end event');
    await collect(model, {
      ...request,
      messages: [
        ...request.messages,
        { role: 'assistant', content: end.content },
        { role: 'user', content: [{ type: 'tool_result', callId: 'toolu_1', content: '{"ok":true}', isError: false }] },
      ],
    });
    const replayed = calls[1]?.params.messages;
    expect(replayed?.[1]).toEqual({ role: 'assistant', content: final.content });
    expect(replayed?.[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}', is_error: false }],
    });
  });
});

describe('cost', () => {
  const opus = MODEL_PRICES['claude-opus-5-5']!;

  it('prices usage per million tokens, including cache reads and writes', () => {
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, opus)).toBe(4);
    expect(costOf({ inputTokens: 5000, outputTokens: 700, cacheReadTokens: 6000, cacheWriteTokens: 0 }, opus)).toBeCloseTo(0.0352, 6);
  });

  it('has the verified prices for the three candidate models', () => {
    expect(MODEL_PRICES).toEqual({
      'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, maxPromptTokens: 100_000 },
    });
  });

  it('prices a call’s worst case at the dearer of input and cache-write prices, plus a full output', () => {
    expect(worstCaseCallCost(1000, 1024, opus)).toBeCloseTo((1000 * 5 + 1024 * 20) / 1e6, 10);
  });

  it.each([
    ['claude-opus-5-5', 0.56192],
    ['claude-sonnet-5-5', 0.28096],
    ['claude-haiku-5-5', 0.014048],
  ])('bounds one %s answer at $%s with the default limits (4 calls × 24,000 input + 1,024 output tokens)', (model, usd) => {
    expect(maxAnswerCost(MODEL_PRICES[model]!, { maxRounds: 4, maxOutputTokens: 1024, maxInputTokensPerCall: 24_000 })).toBeCloseTo(usd, 9);
  });
});

describe('grounding', () => {
  it.each([
    ['5.4M requests', '5.4M requests in six months', []],
    ['2,623 tests', 'grew to 2623 tests', []],
    ['99.9 %', 'a 99.9% non-5xx rate', []],
    ['since 2022', 'Oct 2022 – present', []],
    ['3 brands', 'unrelated', []],
    ['cut costs by 40%', 'cut the bill by 99%', ['40%']],
    ['a team of 15', 'a small team', ['15']],
    ['50 engineers', 'grew to 50,000+ users', ['50']],
    ['5.4 million requests', '5.4M requests', []],
    ['a 99.9 rate', 'a 99.9% non-5xx rate', []],
    ['85% coverage', '85 suites', ['85%']],
    ['2,623 tests', '2,623 tests across 88 suites', []],
    ['version 1.10', 'Terraform 1.10 added this', []],
  ])('%j against %j', (answer, evidence, unsupported) => {
    expect(checkGrounding(answer, [evidence]).unsupportedFigures).toEqual(unsupported);
  });
});

describe('citations', () => {
  it('collects citations from anywhere in tool results, once each', () => {
    const results = [
      { citations: [{ id: 'cv', label: 'CV', kind: 'cv' }] },
      { employment: [{ projects: [{ citations: [{ id: 'cv', label: 'CV', kind: 'cv' }, { id: 'r', label: 'README', url: 'https://x.dev' }] }] }] },
    ];
    expect(collectCitations(results)).toEqual([
      { label: 'CV', kind: 'cv' },
      { label: 'README', url: 'https://x.dev' },
    ]);
  });

  it('finds the projects an answer names', () => {
    const projects = [{ id: 'sol', name: 'SOL' }, { id: 'zim-sbb', name: 'ZIM@SBB' }, { id: 'operafy', name: 'Operafy' }];
    expect(projectsMentioned('SOL and zim@sbb both localise.', projects).map(({ id }) => id)).toEqual(['sol', 'zim-sbb']);
  });
});

describe('transcript', () => {
  const secret = 'a-secret-of-at-least-thirty-two-characters';
  const issuedAt = Date.UTC(2026, 9, 19, 12);
  const turns: TranscriptTurn[] = [
    { role: 'user', text: 'What is SOL?' },
    { role: 'assistant', text: 'SOL is a macOS wallpaper app.' },
    { role: 'user', text: 'Who built it?' },
    { role: 'assistant', text: 'Alex, as a personal project.' },
  ];
  const signed = () => signTranscript(turns, secret, issuedAt);

  it('verifies its own signatures', async () => {
    const transcript = await signed();
    expect(transcript.signature).toMatch(/^v1\./);
    expect(await verifyTranscript(transcript, secret, issuedAt + 1000)).toEqual({ ok: true });
  });

  it.each<[string, (t: TranscriptTurn[]) => TranscriptTurn[]]>([
    ['an edited answer', (t) => [t[0]!, { role: 'assistant', text: 'SOL was built by a team of 50.' }, t[2]!, t[3]!]],
    ['an edited question', (t) => [{ role: 'user', text: 'What is Operafy?' }, ...t.slice(1)]],
    ['a changed role', (t) => [t[0]!, { role: 'user', text: t[1]!.text }, t[2]!, t[3]!]],
    ['reordered turns', (t) => [t[2]!, t[3]!, t[0]!, t[1]!]],
    ['a dropped exchange', (t) => t.slice(2)],
    ['a truncated tail', (t) => t.slice(0, 2)],
    ['an added turn', (t) => [...t, { role: 'assistant', text: 'And Alex led Apple.' }]],
    ['whitespace changes', (t) => t.map((turn) => ({ ...turn, text: `${turn.text} ` }))],
  ])('rejects %s', async (_, tamper) => {
    const transcript = await signed();
    expect(await verifyTranscript({ ...transcript, turns: tamper(transcript.turns) }, secret, issuedAt)).toEqual({ ok: false, reason: 'signature' });
  });

  it('rejects a changed issue time, another key, and malformed signatures', async () => {
    const transcript = await signed();
    expect(await verifyTranscript({ ...transcript, issuedAt: issuedAt + 1 }, secret, issuedAt)).toEqual({ ok: false, reason: 'signature' });
    expect(await verifyTranscript(transcript, 'another-secret-of-thirty-two-characters', issuedAt)).toEqual({ ok: false, reason: 'signature' });
    for (const bad of ['', 'v1.', 'v2.abc', 'garbage', `${transcript.signature}x`]) {
      expect(await verifyTranscript({ ...transcript, signature: bad }, secret, issuedAt)).toEqual({ ok: false, reason: 'signature' });
    }
  });

  it('rejects a replayed transcript once it has expired', async () => {
    const transcript = await signed();
    expect(await verifyTranscript(transcript, secret, issuedAt + TRANSCRIPT_LIMITS.maxAgeMs)).toEqual({ ok: true });
    expect(await verifyTranscript(transcript, secret, issuedAt + TRANSCRIPT_LIMITS.maxAgeMs + 1)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a transcript dated in the future', async () => {
    const transcript = await signed();
    expect(await verifyTranscript(transcript, secret, issuedAt - TRANSCRIPT_LIMITS.clockSkewMs - 1)).toEqual({ ok: false, reason: 'future' });
  });

  it('keeps the newest whole exchanges within the limits', () => {
    const exchange = (index: number): TranscriptTurn[] => [
      { role: 'user', text: `question ${index}` },
      { role: 'assistant', text: `answer ${index}` },
    ];
    const long = Array.from({ length: 10 }, (_, index) => exchange(index)).flat();
    const trimmed = trimTranscript(long);
    expect(trimmed).toHaveLength(12);
    expect(trimmed[0]).toEqual({ role: 'user', text: 'question 4' });
    const huge = [...exchange(0), { role: 'user' as const, text: 'x'.repeat(4000) }, { role: 'assistant' as const, text: 'y'.repeat(4000) }, ...exchange(2), { role: 'user' as const, text: 'z'.repeat(4000) }, { role: 'assistant' as const, text: 'w'.repeat(4000) }];
    expect(trimTranscript(huge).reduce((sum, turn) => sum + turn.text.length, 0)).toBeLessThanOrEqual(12_000);
    expect(trimTranscript(huge)[0]?.role).toBe('user');
  });
});
