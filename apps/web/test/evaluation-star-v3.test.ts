import { describe, expect, it } from 'vitest';
import { STAR_V2_CASES } from '../evaluation/cases-star-v2';
import { LABELLED_PARTS, STAR_V3_CASES } from '../evaluation/cases-star-v3';

const LABEL = 'told as Situation, Task, Action, Result';
const turns = (cases: typeof STAR_V2_CASES) => cases.flatMap(({ turns }) => turns);

describe('STAR suite .6: examples told as one paragraph', () => {
  it('asks the same questions as .5', () => {
    expect(turns(STAR_V3_CASES).map(({ question }) => question)).toEqual(turns(STAR_V2_CASES).map(({ question }) => question));
  });

  it('no longer requires labelled parts, and fails them wherever .5 required them', () => {
    const before = turns(STAR_V2_CASES);
    const after = turns(STAR_V3_CASES);
    expect(after.some((turn) => turn.facts?.some(({ label }) => label === LABEL))).toBe(false);
    const required = before.flatMap((turn, index) => (turn.facts?.some(({ label }) => label === LABEL) ? [index] : []));
    expect(required.length).toBeGreaterThan(0);
    for (const index of required) expect(after[index]!.forbidden).toContain(LABELLED_PARTS);
  });

  it('accepts the hard problem’s range written out (the 2026-10-20 false negative, S3)', () => {
    const [check] = STAR_V3_CASES.find(({ id }) => id === 'star-hard-problem')!.turns[0]!.facts!;
    expect(check!.pattern.test('Response times fell from 0.5 to 1.5 seconds.')).toBe(true);
    expect(check!.pattern.test('Response times fell to 0.5–1.5 seconds.')).toBe(true);
  });

  it('fails part labels and the method’s name, but not ordinary words', () => {
    expect(LABELLED_PARTS.pattern.test('Situation: the promotion broke. Action: Alex fixed it.')).toBe(true);
    expect(LABELLED_PARTS.pattern.test('Here is a STAR example.')).toBe(true);
    expect(LABELLED_PARTS.pattern.test('The situation was urgent, so Alex took action and the result was a fix.')).toBe(false);
  });
});
