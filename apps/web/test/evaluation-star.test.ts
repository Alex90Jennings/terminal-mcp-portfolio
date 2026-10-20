import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBundle } from '@portfolio/knowledge/node';
import { TOOL_MODULES } from '@portfolio/mcp-server';
import { describe, expect, it } from 'vitest';
import { CASE_SET_VERSION, CASES } from '../evaluation/cases';
import { BOTH_OR_ASKS, OPERAFY_SAVING_AS_30, STAR_CASE_SET_VERSION, STAR_CASES, ZIM_SAVING_AS_99 } from '../evaluation/cases-star';
import { SUITES, suiteFor } from '../evaluation/run';
import { caseSetFingerprint, violates } from '../evaluation/score';

const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../content');
// The STAR suite is checked against the knowledge including drafts: the stories are drafts until Alex approves them.
const previewBundle = await loadBundle(contentDir, { includeDrafts: true });
const previewText = JSON.stringify(previewBundle);
const { evidence } = previewBundle;
const evidenceItems = new Map<string, unknown>([
  ...evidence.stories.map((story) => [story.id, story] as const),
  ...[...evidence.interests.personal, ...evidence.interests.technical, ...evidence.background.motivation, ...evidence.background.workingEnvironment].map((item) => [item.id, item] as const),
]);
/** The prose of a story or interest, one field per line: what an answer drawn from it would say. */
const proseOf = (item: unknown): string => {
  const lines: string[] = [];
  const visit = (value: unknown, key = ''): void => {
    if (typeof value === 'string' && ['text', 'detail', 'attributionNote'].includes(key)) lines.push(value);
    else if (Array.isArray(value)) value.forEach((child) => visit(child));
    else if (value !== null && typeof value === 'object') for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
  };
  visit(item);
  return lines.join('\n');
};
const turns = STAR_CASES.flatMap((evalCase) => evalCase.turns.map((spec) => ({ evalCase, spec })));

describe('the baseline is preserved', () => {
  it('keeps the 46-turn case set unchanged as the regression baseline', () => {
    expect(CASE_SET_VERSION).toBe('2026-10-20.2');
    expect(caseSetFingerprint(CASES)).toBe('61e29dc4a1fa991c');
    expect(CASES.reduce((sum, { turns: t }) => sum + t.length, 0)).toBe(46);
  });

  it('versions the STAR suite separately, with its own fingerprint', () => {
    expect(STAR_CASE_SET_VERSION).toMatch(/^star-/);
    expect(suiteFor(STAR_CASE_SET_VERSION)).toBe(SUITES['star-v1']);
    expect(suiteFor(CASE_SET_VERSION)).toBe(SUITES['baseline-v1']);
    expect(caseSetFingerprint(STAR_CASES)).not.toBe(caseSetFingerprint(CASES));
  });
});

describe('the STAR suite', () => {
  it('covers every question Alex listed', () => {
    const asked = turns.map(({ spec }) => spec.question);
    for (const question of [
      'Tell me about a time Alex demonstrated leadership.', 'How does Alex handle disagreements?', 'Give an example of Alex solving a difficult technical problem.',
      'Has Alex received constructive criticism?', 'Tell me about a time Alex made a mistake.', 'How does Alex balance speed and quality?',
      'Has Alex worked with non-technical stakeholders?', 'What has Alex done to reduce infrastructure costs?', "Describe Alex's approach to technical decision-making.",
      'Tell me about a production incident Alex resolved.', 'How does Alex approach accessibility?', 'What motivates Alex professionally?',
      'What does Alex enjoy outside software engineering?', 'Can you give me another example?', "What did Alex personally contribute to ZIM's growth?",
      'Did Alex personally implement all the AWS cost-saving changes?', 'Did the SNS migration reduce costs by a specific percentage?', 'Has Alex managed a team of developers?',
      'Was SOL fully certified as accessible?', 'What languages were supported by ZIM@SBB?', 'Did Alex personally discover the missing Italian translation keys?',
      'Did Alex independently deliver the entire multi-tenant architecture?', 'What did Alex learn from the Black Friday incident?', 'What did Alex change after receiving feedback about deadlines?',
    ]) {
      expect(asked, question).toContain(question);
    }
  });

  it('uses unique ids, distinct from the baseline, and only tools the MCP server provides', () => {
    const ids = STAR_CASES.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(CASES.map((evalCase) => evalCase.id)).not.toContain(id);
    const known = new Set(TOOL_MODULES.map(({ name }) => name));
    for (const { spec } of turns) for (const group of spec.tools ?? []) for (const tool of group) expect(known, tool).toContain(tool);
  });

  it.each(turns.flatMap(({ evalCase, spec }) => (spec.facts ?? []).filter(({ label }) => !/Situation, Task/.test(label)).map((fact) => [`${evalCase.id}: ${fact.label}`, fact.pattern] as const)))(
    'expected fact is in the knowledge, drafts included: %s',
    (_, pattern) => {
      expect(pattern.test(previewText)).toBe(true);
    },
  );

  it('names the stories each case is about, and they exist', () => {
    for (const evalCase of STAR_CASES) {
      expect(evalCase.stories?.length, evalCase.id).toBeGreaterThan(0);
      for (const id of evalCase.stories ?? []) expect(evidenceItems.has(id), `${evalCase.id}: ${id}`).toBe(true);
    }
  });

  it.each(
    turns.flatMap(({ evalCase, spec }) =>
      (spec.forbidden ?? []).flatMap((check) => (evalCase.stories ?? []).map((id) => [`${evalCase.id}: ${check.label} vs ${id}`, check, id] as const)),
    ),
  )('forbidden statement is not something the story says: %s', (_, check, id) => {
    // Scored as answers are: sentence by sentence, excusing negated sentences where the check allows.
    expect(violates(check, proseOf(evidenceItems.get(id)))).toBe(false);
  });

  it('the baseline growth check over-matches test-suite growth (known; fixed only in this suite)', () => {
    const baseline = CASES.find(({ id }) => id === 'zim-scaling-attribution')!.turns[0]!.forbidden![0]!;
    expect(violates(baseline, 'Alex grew the backend automated test suite to 2,623 tests.')).toBe(true);
    const star = STAR_CASES.find(({ id }) => id === 'star-zim-growth')!.turns[0]!.forbidden![0]!;
    expect(violates(star, 'Alex grew the backend automated test suite to 2,623 tests.')).toBe(false);
    expect(violates(star, 'Alex grew the platform to 50,000 users.')).toBe(true);
  });
});

describe('star-2026-10-20.3: ZIM and Operafy cost results stay apart', () => {
  const zim99 = ZIM_SAVING_AS_99;
  const operafy30 = OPERAFY_SAVING_AS_30;

  it.each([
    ["At ZIM, Alex's review led to about a 30% lower AWS bill; on Operafy, Alex's audit cut the bill by 99%.", false],
    ['ZIM reduced its AWS bill by approximately 30%. Operafy’s monthly bill fell by 99%.', false],
    ['ZIM cut its AWS bill by 99%.', true],
    ['The audit saved 99% of the bill at ZIM.', true],
  ])('ZIM’s saving as 99%%: %s', (sentence, expected) => {
    expect(violates(zim99, sentence)).toBe(expected);
  });

  it.each([
    ["Operafy's audit cut the monthly bill by 99%.", false],
    ['Operafy saved 30% on its AWS bill.', true],
    ['The review saved 30% for Operafy.', true],
  ])('Operafy’s saving as 30%%: %s', (sentence, expected) => {
    expect(violates(operafy30, sentence)).toBe(expected);
  });

  it.each([
    ['both results, kept apart', 'There are two. At ZIM, about 30% of the AWS bill. On Operafy, Alex’s own project, 99% of the monthly bill.', true],
    ['a question back', 'Alex has done two cost reviews, at ZIM and on Operafy. Which one do you mean?', true],
    ['one project picked silently', 'The audit cut the monthly bill by 99%.', false],
    ['the other project picked silently', 'It saved approximately 30%.', false],
  ])('an ambiguous cost question accepts %s: %s', (_, answer, expected) => {
    expect(BOTH_OR_ASKS.pattern.test(answer)).toBe(expected);
  });

  it('asks the ambiguous question, and a follow-up on who did what', () => {
    const asked = turns.map(({ spec }) => spec.question);
    expect(asked).toEqual(expect.arrayContaining(['How much did Alex’s AWS cost audit save?', 'Which of those did Alex carry out personally?']));
    expect(STAR_CASE_SET_VERSION).toBe('star-2026-10-20.4');
  });
});
