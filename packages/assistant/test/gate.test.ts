import { describe, expect, it } from 'vitest';
import { toPlainText, withDisplayNames } from '../src/evidence.ts';
import { MAX_HELD_CHARS, SentenceGate } from '../src/gate.ts';
import type { Script } from '../src/scripted.ts';
import { chat } from './helpers.ts';

function gate(evidence: string[]) {
  const emitted: string[] = [];
  return { gate: new SentenceGate(() => evidence, (text) => emitted.push(text)), emitted };
}

describe('SentenceGate', () => {
  it('releases each sentence as soon as it is complete, not at the end', () => {
    const { gate: g, emitted } = gate(['served 5.4M requests at a 99.9% non-5xx rate']);
    g.push('The API served 5.4M ');
    expect(emitted).toEqual([]);
    g.push('requests. It kept a 99.9');
    expect(emitted).toEqual(['The API served 5.4M requests. ']);
    g.push('% rate.');
    g.flush();
    expect(emitted).toEqual(['The API served 5.4M requests. ', 'It kept a 99.9% rate.']);
  });

  it('withholds a whole sentence with an unsupported figure, and keeps the rest', () => {
    const { gate: g, emitted } = gate(['grew backend testing to 2,623 tests']);
    g.push('Testing grew to 2,623 tests. Coverage reached 85%. The CI gate runs on every change.');
    g.flush();
    expect(emitted.join('')).toBe('Testing grew to 2,623 tests. The CI gate runs on every change.');
    expect(g.withheld).toEqual([{ text: 'Coverage reached 85%.', figures: ['85%'] }]);
    expect(g.text).not.toContain('85%');
  });

  it('does not split decimals, versions or names with dots', () => {
    const { gate: g, emitted } = gate(['Next.js 16 and 5.4M requests']);
    g.push('It uses Next.js 16 and handled 5.4M requests.');
    g.flush();
    expect(emitted).toEqual(['It uses Next.js 16 and handled 5.4M requests.']);
  });

  it('releases long runs without a sentence end at a word boundary, still checked', () => {
    const { gate: g, emitted } = gate([]);
    const stream = `${'word '.repeat(70)}and 42 more`;
    for (let index = 0; index < stream.length; index += 5) g.push(stream.slice(index, index + 5));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatch(/^(word )+$/);
    expect(emitted[0]!.length).toBeGreaterThan(MAX_HELD_CHARS - 10);
    g.flush();
    expect(g.withheld).toHaveLength(1);
    expect(g.withheld[0]?.figures).toEqual(['42']);
    expect(g.text).not.toContain('42');
  });

  it('treats line breaks as boundaries, so list items are checked one by one', () => {
    const { gate: g, emitted } = gate(['13 CloudFront distributions']);
    g.push('- 13 CloudFront distributions\n- 40 Lambda functions\n');
    g.flush();
    expect(emitted.join('')).toBe('- 13 CloudFront distributions\n');
    expect(g.withheld.map(({ figures }) => figures)).toEqual([['40']]);
  });
});

/** Looks something up, then answers with the given text. */
const lookupThen =
  (name: string, input: unknown, answer: string): Script =>
  (_request, call) =>
    call === 0 ? { toolCalls: [{ name, input }] } : { text: answer };

describe('grounded answers end to end (real MCP tools)', () => {
  it('shows supported figures and withholds invented ones, with a notice that names the limits of the check', async () => {
    const { outcome, events, text } = await chat(
      lookupThen('get_project', { project: 'zim', sections: ['responsibilities'] }, 'The API served 5.4M requests in six months. Alex also cut latency by 73%.'),
    );
    expect(text).toBe('The API served 5.4M requests in six months. ');
    expect(outcome.answer).toBe('The API served 5.4M requests in six months.');
    expect(outcome.withheld).toEqual([{ text: 'Alex also cut latency by 73%.', figures: ['73%'] }]);
    expect(events.at(-1)).toEqual({ type: 'notice', message: expect.stringMatching(/^One statement was withheld .* covers numbers only/) });
  });

  it('withholds figures stated without any lookup: there is no evidence yet', async () => {
    const { outcome, text } = await chat(() => ({ text: 'Alex has 4 years of experience and 2,623 tests.' }));
    expect(text).toBe('');
    expect(outcome.withheld[0]?.figures).toEqual(['2,623']);
  });

  it('does not accept a figure because the visitor put it in the question', async () => {
    const { outcome } = await chat(
      lookupThen('get_experience', {}, 'Yes, Alex managed 50 engineers.'),
      { question: 'Did Alex manage 50 engineers?' },
    );
    expect(outcome.answer).toBe('');
    expect(outcome.withheld[0]?.figures).toEqual(['50']);
  });

  it('does not accept a figure because an earlier answer said it', async () => {
    const { outcome } = await chat(
      lookupThen('get_profile', {}, 'As I said, the platform has 900,000 users.'),
      { history: [{ role: 'user', text: 'How big is ZIM?' }, { role: 'assistant', text: 'It has 900,000 users.' }], question: 'Remind me how many users?' },
    );
    expect(outcome.answer).toBe('');
    expect(outcome.withheld[0]?.figures).toEqual(['900,000']);
  });

  it('accepts a figure written differently but numerically present (2623 vs 2,623; 99.9 % vs 99.9%)', async () => {
    const { outcome } = await chat(
      lookupThen('get_project', { project: 'zim', sections: ['responsibilities'] }, 'There are 2623 tests and a 99.9 % non-5xx rate.'),
    );
    expect(outcome.withheld).toEqual([]);
  });

  // Limits of a numeric check, pinned down so they stay visible.
  it('LIMIT: a paraphrase that overstates ownership, with no figures, is not caught', async () => {
    const { outcome } = await chat(
      lookupThen('get_project', { project: 'zim', sections: ['responsibilities'] }, 'Alex single-handedly scaled the whole platform.'),
    );
    expect(outcome.answer).toBe('Alex single-handedly scaled the whole platform.');
    expect(outcome.withheld).toEqual([]);
  });

  it('LIMIT: a real figure attached to the wrong fact is not caught', async () => {
    const { outcome } = await chat(
      lookupThen('get_project', { project: 'zim', sections: ['responsibilities'] }, 'The live chat handled 2,623 conversations.'),
    );
    expect(outcome.withheld).toEqual([]);
  });

  it('LIMIT: numbers written as words are not checked', async () => {
    const { outcome } = await chat(lookupThen('get_profile', {}, 'Alex has twelve years of experience.'));
    expect(outcome.withheld).toEqual([]);
  });

  it('streaming stays sentence by sentence: the first sentence arrives before the model finishes', async () => {
    const order: string[] = [];
    let call = 0;
    const { events } = await chat(
      (_request) => {
        call += 1;
        if (call === 1) return { toolCalls: [{ name: 'get_project', input: { project: 'sol', sections: ['overview'] } }] };
        order.push('model-finished');
        return { text: 'SOL is a macOS menu bar app. It animates the solar system as the wallpaper. It is free, with a Pro upgrade.' };
      },
    );
    const textEvents = events.filter((event) => event.type === 'text');
    expect(textEvents.length).toBeGreaterThanOrEqual(3);
    expect(textEvents[0]).toEqual({ type: 'text', delta: 'SOL is a macOS menu bar app. ' });
  });
});

describe('internal project ids (regression: answers showed ids and tags)', () => {
  const present = withDisplayNames([
    { id: 'zim-sbb', name: 'ZIM@SBB' },
    { id: 'zim-connections', name: 'ZIM Connections' },
    { id: 'clash-of-langs', name: 'Clash of Langs' },
    { id: 'sol', name: 'SOL' },
  ]);

  it.each([
    ['Ask about zim-sbb next.', 'Ask about ZIM@SBB next.'],
    ['See ZIM-CONNECTIONS and clash-of-langs.', 'See ZIM Connections and Clash of Langs.'],
    ['SOL and sol stay as written.', 'SOL and sol stay as written.'],
    ['The operafy-infra README and portfolio://projects/zim-sbb are untouched.', 'The operafy-infra README and portfolio://projects/zim-sbb are untouched.'],
    ['zim-sbb-v2 is a different identifier.', 'zim-sbb-v2 is a different identifier.'],
  ])('shows %j as %j', (input, expected) => {
    expect(present(input)).toBe(expected);
  });

  it('applies the display names after the figure check, which still sees the original sentence', () => {
    const emitted: string[] = [];
    const g = new SentenceGate(() => ['zim-sbb ships in four languages'], (text) => emitted.push(text), present);
    g.push('zim-sbb ships in four languages. zim-sbb has 47 brands.');
    g.flush();
    expect(emitted.join('')).toBe('ZIM@SBB ships in four languages. ');
    expect(g.withheld).toEqual([{ text: 'zim-sbb has 47 brands.', figures: ['47'] }]);
  });

  it('never lets an id reach the visitor through runChat', async () => {
    const { text, outcome } = await chat((_request, call) =>
      call === 0 ? { toolCalls: [{ name: 'get_project', input: { project: 'zim-sbb', sections: ['overview'] } }] } : { text: 'zim-sbb is a white-label build.' },
    );
    expect(text).toBe('ZIM@SBB is a white-label build.');
    expect(outcome.answer).not.toContain('zim-sbb');
  });
});

describe('plain text in the terminal (regression: answers used Markdown bold)', () => {
  it.each([
    ['- **Network and edge:** The API runs on EC2.', '- Network and edge: The API runs on EC2.'],
    ['Its clearest backend work is on **ZIM Connections**.', 'Its clearest backend work is on ZIM Connections.'],
    ['## Heading\nText', 'Heading\nText'],
    ['Uses 5 * 3 and snake_case names.', 'Uses 5 * 3 and snake_case names.'],
  ])('shows %j as %j', (input, expected) => {
    expect(toPlainText(input)).toBe(expected);
  });

  it('strips bold through runChat, after the figure check', async () => {
    const { text } = await chat((_request, call) =>
      call === 0 ? { toolCalls: [{ name: 'get_project', input: { project: 'operafy', sections: ['decisions'] } }] } : { text: '**Operafy** uses GitHub OIDC.' },
    );
    expect(text).toBe('Operafy uses GitHub OIDC.');
  });
});
