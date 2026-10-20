import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import bundle from '@portfolio/knowledge/bundle.json';
import { TOOL_MODULES } from '@portfolio/mcp-server';
import { describe, expect, it } from 'vitest';
import { CASES } from '../evaluation/cases';
import { STAR_CASE_SET_VERSION, STAR_CASES } from '../evaluation/cases-star';
import { STAR_V2_CASE_SET_VERSION, STAR_V2_CASES } from '../evaluation/cases-star-v2';
import { STAR_V3_CASE_SET_VERSION, STAR_V3_CASES } from '../evaluation/cases-star-v3';
import { CASES_V2 } from '../evaluation/cases-v2';
import { BASELINE_V3_VERSION, CASES_V3 } from '../evaluation/cases-v3';
import { SUITES, spentByEarlierEvaluations, suiteFor, type EvaluationReport } from '../evaluation/run';
import { caseSetFingerprint, scoreTurn, violates, type TurnRecord } from '../evaluation/score';
import { serverKb } from '@/server/knowledge';

const knowledgeText = JSON.stringify(bundle);
const resultsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../evaluation/results');
const turnOf = (cases: readonly (typeof CASES)[number][], id: string, turn = 1) => cases.find((evalCase) => evalCase.id === id)!.turns[turn - 1]!;
const caseOf = (cases: readonly (typeof CASES)[number][], id: string) => cases.find((evalCase) => evalCase.id === id)!;
const record = (answer: string, sources: string[], toolsCalled = ['get_project', 'get_experience', 'search_projects', 'get_examples']): TurnRecord => ({
  caseId: 'x', turn: 1, question: 'q', answer, stop: 'complete', toolsCalled, sources: sources.map((label) => ({ label })), projects: [], notices: [], withheldStatements: 0, firstTextMs: 100, totalMs: 1000, costUsd: 0.01,
});
/** A recorded answer, verbatim, from a saved result (gitignored, so skipped where it isn't present). */
const recorded = (file: string, caseId: string, turn = 1) => {
  try {
    const report = JSON.parse(readFileSync(path.join(resultsDir, file), 'utf8')) as EvaluationReport;
    return report.runs[0]!.records.find((item) => item.caseId === caseId && item.turn === turn);
  } catch {
    return undefined;
  }
};

describe('versions', () => {
  it('makes baseline v3 and STAR .6 the defaults, keeping every earlier version under its own name', () => {
    expect(SUITES.baseline).toEqual({ version: BASELINE_V3_VERSION, cases: CASES_V3 });
    expect(SUITES.star).toEqual({ version: STAR_V3_CASE_SET_VERSION, cases: STAR_V3_CASES });
    expect(SUITES['star-v2']).toEqual({ version: STAR_V2_CASE_SET_VERSION, cases: STAR_V2_CASES });
    expect(suiteFor(STAR_V2_CASE_SET_VERSION).cases).toBe(STAR_V2_CASES);
    expect(SUITES['star-v1'].cases).toBe(STAR_CASES);
    expect(suiteFor('2026-10-20.3').cases).toBe(CASES_V2);
    expect(suiteFor(STAR_CASE_SET_VERSION).cases).toBe(STAR_CASES);
    expect(suiteFor(BASELINE_V3_VERSION).cases).toBe(CASES_V3);
    expect(caseSetFingerprint(CASES)).toBe('61e29dc4a1fa991c');
    expect(caseSetFingerprint(CASES_V2)).toBe('de9a4ebde422d0e4');
    expect(caseSetFingerprint(STAR_CASES)).toBe('02b70ab99640f70c');
  });

  it('baseline v3 asks the same 46 questions; STAR .5 keeps every .4 question and adds the interview questions', () => {
    const questions = (cases: readonly (typeof CASES)[number][]) => cases.flatMap(({ id, turns }) => turns.map(({ question }) => `${id}: ${question}`));
    expect(questions(CASES_V3)).toEqual(questions(CASES));
    expect(questions(STAR_V2_CASES).slice(0, 33)).toEqual(questions(STAR_CASES));
    expect(STAR_V2_CASES.reduce((sum, { turns }) => sum + turns.length, 0)).toBe(51);
  });

  it('only changes cases that exist', () => {
    for (const id of ['operafy-cost-audit', 'certifications', 'sbb-localisation', 'sbb-ai-translations', 'attention-to-detail']) expect(caseOf(CASES_V3, id), id).toBeDefined();
  });

  it('uses unique ids, real tools and real stories; facts are in the published knowledge; forbidden statements aren’t true of their stories or projects', () => {
    const ids = STAR_V2_CASES.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    const known = new Set(TOOL_MODULES.map(({ name }) => name));
    const prose = (id: string) => JSON.stringify([serverKb.getStory(id), ...[...serverKb.evidence.interests.personal, ...serverKb.evidence.interests.technical, ...serverKb.evidence.background.motivation, ...serverKb.evidence.background.workingEnvironment].filter((item) => item.id === id)]);
    for (const evalCase of [...STAR_V2_CASES, ...CASES_V3]) {
      for (const turn of evalCase.turns) {
        for (const group of turn.tools ?? []) for (const tool of group) expect(known, tool).toContain(tool);
        for (const check of turn.facts ?? []) if (!/Situation, Task/.test(check.label)) expect(check.pattern.test(knowledgeText), `${evalCase.id}: ${check.label}`).toBe(true);
        for (const check of turn.forbidden ?? []) {
          for (const id of evalCase.stories ?? []) expect(prose(id) === '[null]' ? false : violates(check, prose(id)), `${evalCase.id}: ${check.label} vs ${id}`).toBe(false);
          for (const id of evalCase.projects) expect(check.pattern.test(JSON.stringify(serverKb.getProject(id))), `${evalCase.id}: ${check.label} vs ${id}`).toBe(false);
        }
      }
      for (const id of evalCase.stories ?? []) expect(prose(id), `${evalCase.id}: ${id}`).not.toBe('[null]');
    }
  });
});

describe('the five scorer errors from the 2026-10-20 review, fixed', () => {
  it('1. a language named twice is not an invented list; two different names still are', () => {
    const spec = turnOf(CASES_V3, 'sbb-which-languages');
    const answer = "The portfolio says ZIM@SBB ships in four languages, but it doesn't name them. It does mention Italian, since missing Italian translation keys were caught before release.";
    expect(scoreTurn(turnOf(CASES_V2, 'sbb-which-languages'), record(answer, ['CV (September 2026)']), serverKb, knowledgeText).violations).toHaveLength(1);
    expect(scoreTurn(spec, record(answer, ['CV (September 2026)']), serverKb, knowledgeText).violations).toEqual([]);
    expect(spec.forbidden!.some((check) => violates(check, 'It supports German, French, Italian and English.'))).toBe(true);
  });

  it('2. an answer citing only a story’s own sources is relevant', () => {
    const spec = turnOf(STAR_V2_CASES, 'star-black-friday-lesson');
    const score = scoreTurn(spec, record('By Alex’s own account, promotional logic should be tested against existing customer entitlements, and fixing a production issue means strengthening the tests.', ['Alex, interview answers (20 Oct 2026)', 'Alex, final confirmations (20 Oct 2026)']), serverKb, knowledgeText);
    expect(score.sources).toMatchObject({ relevant: true, precision: 1 });
    expect(score.pass).toBe(true);
  });

  it('3. "another developer" is a collaboration example', () => {
    const spec = turnOf(STAR_V2_CASES, 'star-mt-collaboration');
    expect(spec.facts![0]!.pattern.test('Alex collaborated with another developer over several months.')).toBe(true);
  });

  it('4. any documented project owned end to end, found with a project tool, is a correct first answer', () => {
    expect(turnOf(STAR_V2_CASES, 'star-mt-live-chat').tools).toEqual([['get_examples', 'get_project', 'search_projects', 'get_skills']]);
  });

  it('5. Operafy’s 99%, correctly attributed, is not an invented SNS saving; a percentage for the SNS migration is', () => {
    const [check] = turnOf(STAR_V2_CASES, 'star-sns-percentage').forbidden!;
    expect(violates(check!, 'The 99% figure belongs to a different piece of work. In Operafy, Alex removed orphaned resources, which cut the monthly bill by 99%. That was not the SNS migration.')).toBe(false);
    expect(violates(check!, 'The SNS migration cut notification costs by 40%.')).toBe(true);
    expect(violates(check!, "The portfolio doesn't record a cost reduction percentage for the SNS migration.")).toBe(false);
  });

  it('the genuine failure stays a failure: saying no decision-making example exists', () => {
    const spec = turnOf(STAR_V2_CASES, 'star-decisions');
    const answer = 'Alex chose an exact pgvector scan for Total Guess. The portfolio has no published "tell me about a time" example for decision-making.';
    expect(scoreTurn(spec, record(answer, ['docs/retrieval.md']), serverKb, knowledgeText).violations).toContainEqual({ label: 'says no decision-making example exists', kind: 'claim' });
  });
});

describe('baseline v3: new checks', () => {
  it('the ambiguous AWS cost question accepts both results kept apart, or a question back, and nothing else', () => {
    const spec = turnOf(CASES_V3, 'operafy-cost-audit');
    const sources = ['operafy-infra README', 'Alex, interview answers (20 Oct 2026)'];
    const both = 'There are two. On Operafy, Alex’s audit cut the monthly bill by 99%. At ZIM, by Alex’s account, the AWS bill fell by about 30% after Alex’s recommendations.';
    expect(scoreTurn(spec, record(both, sources), serverKb, knowledgeText).pass).toBe(true);
    expect(scoreTurn(spec, record('The audit cut the monthly bill by 99%.', sources), serverKb, knowledgeText).pass).toBe(false);
    expect(scoreTurn(spec, record('Operafy saved 30% on its AWS bill, and ZIM cut its bill by 99%.', sources), serverKb, knowledgeText).violations.length).toBeGreaterThan(0);
  });

  it.each([
    ['certifications', 'Alex holds three AWS certifications.', true],
    ['certifications', 'Alex holds two AWS certifications and is studying for Solutions Architect – Associate.', false],
    ['sbb-ai-translations', 'Alex built a key-comparison script to find the missing keys.', true],
    ['sbb-ai-translations', 'Alex fixed both defects before release.', true],
    ['sbb-ai-translations', 'Alex identified both defects during pre-release testing, and both were fixed before release.', false],
  ])('%s: "%s" violates: %s', (id, sentence, expected) => {
    expect(turnOf(CASES_V3, id).forbidden!.some((check) => violates(check, sentence))).toBe(expected);
  });

  it('replays the recorded 2026-10-20 failures: both pass v2 and fail v3', () => {
    for (const [caseId] of [['sbb-localisation'], ['certifications']] as const) {
      const answer = recorded('2026-10-20T12-29-40-494Z.json', caseId);
      if (answer === undefined) continue;
      const v2 = scoreTurn(turnOf(CASES_V2, caseId), answer, serverKb, knowledgeText);
      const v3 = scoreTurn(turnOf(CASES_V3, caseId), answer, serverKb, knowledgeText);
      expect(v2.violations, caseId).toEqual([]);
      expect(v3.violations.length, caseId).toBeGreaterThan(0);
    }
  });
});

describe('the cumulative evaluation cap', () => {
  const report = (costs: number[], meta: Partial<EvaluationReport['meta']> = {}) =>
    ({ meta: { dryRun: false, ...meta }, runs: [{ records: costs.map((costUsd) => ({ costUsd })) }] }) as unknown as EvaluationReport;

  it('sums paid evaluations only: dry runs and offline re-scores spend nothing', () => {
    expect(spentByEarlierEvaluations([report([0.02, 0.03]), report([1], { dryRun: true }), report([0.04], { rescoredFrom: 'x.json' }), report([0.01])])).toBeCloseTo(0.06);
  });
});
