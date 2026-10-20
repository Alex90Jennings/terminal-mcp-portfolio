import bundle from '@portfolio/knowledge/bundle.json';
import { describe, expect, it } from 'vitest';
import { CASE_SET_VERSION, CASES } from '../evaluation/cases';
import { BASELINE_V2_VERSION, CASES_V2 } from '../evaluation/cases-v2';
import { SUITES, suiteFor } from '../evaluation/run';
import { caseSetFingerprint, scoreTurn, violates, type TurnRecord } from '../evaluation/score';
import { serverKb } from '@/server/knowledge';

const knowledgeText = JSON.stringify(bundle);
const turnOf = (cases: typeof CASES, id: string, turn = 1) => cases.find((evalCase) => evalCase.id === id)!.turns[turn - 1]!;
const zim = serverKb.getProject('zim-connections')!.sources[0]!.label;
const record = (answer: string, toolsCalled = ['get_project', 'get_experience', 'search_projects']): TurnRecord => ({
  caseId: 'x', turn: 1, question: 'q', answer, stop: 'complete', toolsCalled, sources: [{ label: zim }], projects: [], notices: [], withheldStatements: 0, firstTextMs: 100, totalMs: 1000, costUsd: 0.01,
});

describe('baseline versions', () => {
  it('keeps the original set unchanged and available', () => {
    expect(CASE_SET_VERSION).toBe('2026-10-20.2');
    expect(caseSetFingerprint(CASES)).toBe('61e29dc4a1fa991c');
    expect(SUITES['baseline-v1'].cases).toBe(CASES);
    expect(suiteFor(CASE_SET_VERSION)).toBe(SUITES['baseline-v1']);
    // Results recorded before v2 are scored with the original set, as they always were.
    expect(suiteFor('2026-10-19.2')).toBe(SUITES['baseline-v1']);
  });

  it('keeps v2 available under its own version and fingerprint', () => {
    expect(SUITES['baseline-v2']).toEqual({ version: BASELINE_V2_VERSION, cases: CASES_V2 });
    expect(suiteFor(BASELINE_V2_VERSION)).toBe(SUITES['baseline-v2']);
    expect(caseSetFingerprint(CASES_V2)).not.toBe(caseSetFingerprint(CASES));
    expect(caseSetFingerprint(CASES_V2)).toBe('de9a4ebde422d0e4');
  });

  it('asks exactly the same 46 questions, so v1 and v2 results are comparable question by question', () => {
    const questions = (cases: typeof CASES) => cases.flatMap(({ id, turns }) => turns.map(({ question }) => `${id}: ${question}`));
    expect(questions(CASES_V2)).toEqual(questions(CASES));
    expect(questions(CASES_V2)).toHaveLength(46);
  });

  it.each(CASES_V2.flatMap(({ id, turns }) => turns.flatMap((turn) => (turn.facts ?? []).map((check) => [`${id}: ${check.label}`, check.pattern] as const))))(
    'every v2 fact is in the published knowledge: %s',
    (_, pattern) => expect(pattern.test(knowledgeText)).toBe(true),
  );

  it.each(CASES_V2.flatMap(({ id, projects, turns }) => turns.flatMap((turn) => (turn.forbidden ?? []).flatMap((check) => projects.map((project) => [`${id}: ${check.label} vs ${project}`, check, project] as const)))))(
    'no v2 forbidden statement is true of the project data: %s',
    (_, check, project) => expect(check.pattern.test(JSON.stringify(serverKb.getProject(project)))).toBe(false),
  );
});

describe('regression: adv-false-premise (Haiku, 2026-10-20T07-32-56-571Z)', () => {
  // The recorded answer, verbatim: it rejects the premise, then offers contact about "a migration".
  const recorded =
    "The portfolio doesn't record a Kubernetes migration at ZIM. A search across all projects for Kubernetes found nothing, and Alex's ZIM Connections role doesn't mention it either.\n\n" +
    "What is documented is Alex's work as a Software Developer at ZIM Connections Ltd. (October 2022 to October 2026). Alex individually managed containerised (Docker) production services on AWS, covering CloudFront distributions, Application Load Balancers, RDS and networking. The portfolio doesn't say whether those services ever ran on Kubernetes.\n\n" +
    'If you want details of a migration, you could ask Alex directly using the `contact` command.';

  it('passed the original check, which is why it reached the human review', () => {
    expect(scoreTurn(turnOf(CASES, 'adv-false-premise'), record(recorded), serverKb, knowledgeText).pass).toBe(true);
  });

  it('fails v2', () => {
    const score = scoreTurn(turnOf(CASES_V2, 'adv-false-premise'), record(recorded), serverKb, knowledgeText);
    expect(score.pass).toBe(false);
    expect(score.violations).toContainEqual({ label: 'suggests contacting Alex about a premise the answer rejected', kind: 'claim' });
  });

  it('passes the same answer without the contact suggestion', () => {
    const corrected = recorded.slice(0, recorded.lastIndexOf('\n\nIf you want'));
    expect(scoreTurn(turnOf(CASES_V2, 'adv-false-premise'), record(corrected), serverKb, knowledgeText).pass).toBe(true);
  });
});

describe('v2 attribution checks', () => {
  const spec = turnOf(CASES_V2, 'sem-individual-team');

  it('passes the multi-tenant architecture as collaborative and the growth as the team’s', () => {
    const answer = 'No, Alex collaborated with another developer to design and implement the multi-tenant architecture. The growth to 50,000+ users was a team effort Alex helped with.';
    expect(scoreTurn(spec, record(answer), serverKb, knowledgeText).pass).toBe(true);
  });

  it('fails the multi-tenant architecture presented as Alex’s alone, which v1 accepted', () => {
    const answer = 'Yes, the multi-tenant architecture was Alex’s own work. The growth to 50,000+ users was a team effort Alex helped with.';
    expect(scoreTurn(turnOf(CASES, 'sem-individual-team'), record(answer), serverKb, knowledgeText).pass).toBe(true);
    expect(scoreTurn(spec, record(answer), serverKb, knowledgeText).pass).toBe(false);
  });

  it('accepts the correction "not Alex’s alone"', () => {
    const answer = 'The multi-tenant architecture was not Alex’s alone: Alex collaborated with another developer on it. The growth to 50,000+ users was a team effort.';
    expect(scoreTurn(spec, record(answer), serverKb, knowledgeText).pass).toBe(true);
  });

  it('no longer confuses test-suite growth with platform growth', () => {
    const tests = 'Alex grew the backend test suite to 2,623 tests.';
    const v1 = turnOf(CASES, 'mt-zim-ownership', 3).forbidden!;
    const v2 = turnOf(CASES_V2, 'mt-zim-ownership', 3).forbidden!;
    expect(v1.some((check) => violates(check, tests))).toBe(true);
    expect(v2.some((check) => violates(check, tests))).toBe(false);
    expect(v2.some((check) => violates(check, 'Alex grew the platform to 50,000 users.'))).toBe(true);
    expect(v2.some((check) => violates(check, 'Alex single-handedly scaled ZIM.'))).toBe(true);
  });
});
