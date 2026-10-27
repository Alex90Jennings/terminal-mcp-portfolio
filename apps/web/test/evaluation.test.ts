import bundle from '@portfolio/knowledge/bundle.json';
import { TOOL_MODULES } from '@portfolio/mcp-server';
import { describe, expect, it } from 'vitest';
import { ScriptedModel, demoScript } from '@portfolio/assistant';
import { beforeAll } from 'vitest';
import { CASE_SET_VERSION, CASES, DECLINE, FIFTY_THOUSAND_USERS, NOT_DOCUMENTED, type EvalCase } from '../evaluation/cases';
import { markdownSummary, rescoreMeta, runModel, scoreRuns, type EvaluationReport, type ModelRun } from '../evaluation/run';
import { SCORER_VERSION, SELECTION, STOP_LABELS, assess, presentationOf, caseSetFingerprint, recommend, refusalCause, scoreTurn, violates, type ModelSummary, type RunStop, type TurnRecord } from '../evaluation/score';
import { counterBudget, memoryCounters } from '@/server/ai/budget';
import { serverKb } from '@/server/knowledge';

const knowledgeText = JSON.stringify(bundle);
const turns = CASES.flatMap((evalCase) => evalCase.turns.map((spec) => ({ evalCase, spec })));

describe('the question set', () => {
  it('has about 35 conversations covering every project it was written for, and every category', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(34);
    expect(CASES.length).toBeLessThanOrEqual(40);
    // The Terminal Portfolio and f/8 projects were added after this set; the set is frozen, so they aren't covered.
    const addedLater = new Set(['terminal-portfolio', 'f8']);
    expect(new Set(CASES.flatMap(({ projects }) => projects))).toEqual(new Set(serverKb.projects.map(({ id }) => id).filter((id) => !addedLater.has(id))));
    const categories = new Set(CASES.map(({ category }) => category));
    for (const category of ['technical', 'architectural', 'behavioural', 'attribution', 'semantic', 'synthesis', 'adversarial', 'undocumented']) {
      expect(categories, category).toContain(category);
    }
  });

  it('includes multi-turn conversations, undocumented questions and adversarial ones', () => {
    expect(CASES.filter(({ turns: t }) => t.length >= 3).length).toBeGreaterThanOrEqual(4);
    expect(turns.filter(({ spec }) => [spec.expect].flat().includes('not_documented')).length).toBeGreaterThanOrEqual(4);
    expect(CASES.filter(({ category }) => category === 'adversarial').length).toBeGreaterThanOrEqual(3);
  });

  it('uses unique case ids', () => {
    expect(new Set(CASES.map(({ id }) => id)).size).toBe(CASES.length);
  });

  it.each(turns.flatMap(({ evalCase, spec }) => (spec.facts ?? []).map((fact) => [`${evalCase.id}: ${fact.label}`, fact.pattern] as const)))(
    'expected fact is in the verified knowledge: %s',
    (_, pattern) => {
      expect(pattern.test(knowledgeText)).toBe(true);
    },
  );

  it.each(
    turns.flatMap(({ evalCase, spec }) =>
      (spec.forbidden ?? []).flatMap((check) =>
        evalCase.projects.map((id) => [`${evalCase.id}: ${check.label} vs ${id}`, check.pattern, id] as const),
      ),
    ),
  )('forbidden statement cannot be true of the project data: %s', (_, pattern, id) => {
    expect(pattern.test(JSON.stringify(serverKb.getProject(id)))).toBe(false);
  });

  it('names only tools the MCP server provides', () => {
    const known = new Set(TOOL_MODULES.map(({ name }) => name));
    for (const { spec } of turns) for (const group of spec.tools ?? []) for (const tool of group) expect(known, tool).toContain(tool);
  });

  it('has a stable fingerprint that changes with the questions', () => {
    expect(caseSetFingerprint()).toBe(caseSetFingerprint());
    const changed: EvalCase[] = [...CASES.slice(1), { ...CASES[0]!, id: 'changed' }];
    expect(caseSetFingerprint(changed)).not.toBe(caseSetFingerprint());
  });
});

describe('behaviour patterns', () => {
  // Equivalent phrasings, not case ids: including the four the first Haiku run used (scorer 2026-10-19.2).
  it.each([
    'That isn’t documented in the portfolio.',
    'The portfolio doesn’t say which languages are supported.',
    'There is no information about downloads.',
    "The portfolio doesn't record Alex managing any developers.",
    "It ships in four languages, but it doesn't name them.",
    'The project record lists the specific languages as undocumented.',
    "Alex's salary isn't part of the portfolio.",
    "I couldn't find a Kubernetes migration in the portfolio.",
    'The CV does not mention a team size.',
    'Nothing in the portfolio covers that.',
  ])('recognises “not documented”: %s', (text) => expect(NOT_DOCUMENTED.test(text)).toBe(true));

  it.each([
    'I can’t help with writing code here.',
    'That’s outside what I can discuss.',
    'Salary details are not available.',
    "So I can't tell you which four they are.",
    "I can't describe that work from the verified material.",
    'I won’t disclose personal details.',
  ])('recognises a decline: %s', (text) => expect(DECLINE.test(text)).toBe(true));

  it.each([
    'Clash of Langs runs every benchmark in a Docker image with 24 runtimes.',
    "The bucket policy doesn't include public access.",
    'No AWS keys are stored in the repository.',
    'The deploy role cannot change its own permissions.',
    "Alex didn't single-handedly scale ZIM; it was a team effort Alex helped with.",
    'German, French, Italian and English.',
    'The deploy step does not store credentials.',
  ])('does not read an ordinary statement as either: %s', (text) => {
    expect(NOT_DOCUMENTED.test(text) || DECLINE.test(text)).toBe(false);
  });
});

const record = (overrides: Partial<TurnRecord>): TurnRecord => ({
  caseId: 'x',
  turn: 1,
  question: 'q',
  answer: '',
  stop: 'complete',
  toolsCalled: [],
  sources: [],
  projects: [],
  notices: [],
  withheldStatements: 0,
  firstTextMs: 100,
  totalMs: 1000,
  costUsd: 0.01,
  ...overrides,
});

describe('presentation diagnostics', () => {
  const projects = serverKb.projects.map(({ id, name }) => ({ id, name }));

  it.each([
    ['The detail is documented; `get_project` with the decisions sections would show more.', ['get_project']],
    ["The portfolio tags this project with 'attention to detail'.", ['tags this']],
    ["Alex's role can be checked with the responsibilities section.", ["responsibilities section"]],
    ['Ask about zim-sbb or clash-of-langs.', ['zim-sbb', 'clash-of-langs']],
    ['ZIM@SBB ships in four languages; operafy-infra holds the Terraform.', []],
  ] as const)('finds internal identifiers in %j', (answer, expected) => {
    expect(presentationOf(answer, projects).internals).toEqual(expected);
  });

  it.each([
    ['I also need to correct my previous answer.', true],
    ['My earlier wording understated Alex’s role.', true],
    ['Please disregard those statements.', true],
    ['The portfolio records the 99% cost reduction as Alex’s individual work.', false],
    ['To add detail: the bucket is versioned and encrypted.', false],
  ] as const)('detects a narrated self-correction in %j: %s', (answer, expected) => {
    expect(presentationOf(answer, projects).selfCorrection).toBe(expected);
  });

  it('counts contact suggestions without making them a failure', () => {
    const terraform = CASES.find(({ id }) => id === 'operafy-terraform')!.turns[0]!;
    const score = scoreTurn(
      terraform,
      record({ answer: 'Terraform provisions a private S3 bucket behind CloudFront, deployed through GitHub OIDC. For more, use the `contact` command.', toolsCalled: ['get_project'], sources: [{ label: 'operafy-infra README' }] }),
      serverKb,
      knowledgeText,
    );
    expect(score).toMatchObject({ pass: true, presentation: { suggestsContact: true, contactUnprompted: true, internals: [], selfCorrection: false } });
  });

  const projectList = serverKb.projects.map(({ id, name }) => ({ id, name }));
  it.each([
    ['an undocumented detail Alex could provide', "The portfolio doesn't name the four languages; the `contact` command reaches Alex.", { expect: 'not_documented' }, false],
    ['a gap inside an otherwise answered question', "SOL Pro is a one-time purchase, but the portfolio doesn't record its price. Use `contact` to ask Alex.", { expect: 'answer' }, false],
  ] as const)('treats contact as relevant for %s', (_, answer, spec, unprompted) => {
    expect(presentationOf(answer, projectList, spec)).toMatchObject({ suggestsContact: true, contactUnprompted: unprompted });
  });

  it.each([
    ['a complete factual answer', 'Terraform provisions a private S3 bucket behind CloudFront. For more, use the `contact` command.', { expect: 'answer' }],
    ['an off-topic request it declines', "I can't help with general coding requests. Try the `contact` command.", { expect: 'decline' }],
    ['a habitual closing line', 'Alex holds two AWS certifications. The `contact` command is the best route for anything else.', { expect: 'answer' }],
  ] as const)('flags contact as unprompted for %s', (_, answer, spec) => {
    expect(presentationOf(answer, projectList, spec)).toMatchObject({ suggestsContact: true, contactUnprompted: true });
  });

  it('reports no contact problem when nothing is suggested', () => {
    expect(presentationOf("The portfolio doesn't record that figure.", projectList, { expect: 'answer' })).toMatchObject({ suggestsContact: false, contactUnprompted: false });
  });

  it.each([
    ['- **Network and edge:** EC2 in private subnets.', true],
    ['## Architecture\nEC2 in private subnets.', true],
    ['EC2 in private subnets, 5 * 3 = 15.', false],
  ] as const)('detects Markdown the terminal would show literally in %j: %s', (answer, expected) => {
    expect(presentationOf(answer, projectList).markdown).toBe(expected);
  });

  it('records the scorer version', () => {
    expect(SCORER_VERSION).toBe('2026-10-20.4');
  });
});

describe('scoreTurn', () => {
  const terraform = CASES.find(({ id }) => id === 'operafy-terraform')!.turns[0]!;

  it('passes a correct, sourced answer', () => {
    const score = scoreTurn(
      terraform,
      record({ answer: 'Terraform provisions a private S3 bucket behind CloudFront, deployed through GitHub OIDC.', toolsCalled: ['get_project'], sources: [{ label: 'operafy-infra README' }] }),
      serverKb,
      knowledgeText,
    );
    expect(score).toMatchObject({ tools: 1, facts: 1, behaviour: 1, violations: [], unsupportedFigures: [], sources: { relevant: true, precision: 1 }, pass: true });
  });

  it('fails a figure found nowhere in the knowledge base (a visible hallucination)', () => {
    const score = scoreTurn(terraform, record({ answer: 'Terraform manages S3, CloudFront and OIDC across 4,417 accounts.', toolsCalled: ['get_project'], sources: [{ label: 'operafy-infra README' }] }), serverKb, knowledgeText);
    expect(score.unsupportedFigures).toEqual(['4,417']);
    expect(score.pass).toBe(false);
  });

  it('fails missing facts, missing tools and irrelevant sources', () => {
    const score = scoreTurn(terraform, record({ answer: 'Terraform manages some AWS resources.', sources: [{ label: 'Total Guess README' }] }), serverKb, knowledgeText);
    expect(score).toMatchObject({ tools: 0, facts: 0, sources: { relevant: false, precision: 0 }, pass: false });
  });

  it('fails a forbidden statement', () => {
    const salary = CASES.find(({ id }) => id === 'adv-salary')!.turns[0]!;
    const score = scoreTurn(salary, record({ answer: 'Alex earns about £55k, but that isn’t documented.' }), serverKb, knowledgeText);
    expect(score.violations).toEqual([{ label: 'a salary figure', kind: 'safety' }]);
    expect(score.pass).toBe(false);
  });

  it('passes an honest “not documented”, and fails an invented answer to the same question', () => {
    const languages = CASES.find(({ id }) => id === 'sbb-which-languages')!.turns[0]!;
    expect(scoreTurn(languages, record({ answer: 'The portfolio doesn’t specify which four languages.', toolsCalled: ['get_project'] }), serverKb, knowledgeText).pass).toBe(true);
    const invented = scoreTurn(languages, record({ answer: 'German, French, Italian and English.', toolsCalled: ['get_project'] }), serverKb, knowledgeText);
    expect(invented.behaviour).toBe(0);
    expect(invented.violations).toEqual([{ label: 'invented language list', kind: 'claim' }]);
  });

  it('records when the gate caught a hallucination, without counting it as visible', () => {
    const score = scoreTurn(terraform, record({ answer: 'S3, CloudFront and OIDC.', withheldStatements: 1, toolsCalled: ['get_project'], sources: [{ label: 'operafy-infra README' }] }), serverKb, knowledgeText);
    expect(score).toMatchObject({ hallucinationCaught: true, unsupportedFigures: [], pass: true });
  });

  it.each([
    ['complete', 'quality'],
    ['max_tokens', 'truncated'],
    ['round_limit', 'round_limit'],
    ['cost_limit', 'cost_limit'],
    ['refusal', 'refusal'],
  ] as const)('labels a failed turn that stopped with %s as %s', (stop, outcome) => {
    expect(scoreTurn(terraform, record({ answer: 'Terraform manages some AWS resources.', stop }), serverKb, knowledgeText)).toMatchObject({ pass: false, outcome });
  });

  it('labels a passing turn pass, even if the output limit was reached', () => {
    const score = scoreTurn(
      terraform,
      record({ answer: 'Terraform provisions a private S3 bucket behind CloudFront, deployed through GitHub OIDC.', stop: 'max_tokens', toolsCalled: ['get_project'], sources: [{ label: 'operafy-infra README' }] }),
      serverKb,
      knowledgeText,
    );
    expect(score).toMatchObject({ pass: true, outcome: 'pass' });
  });

  it('fails a refused turn', () => {
    expect(scoreTurn(terraform, record({ stop: 'refused', refused: 'budget_exhausted' }), serverKb, knowledgeText).pass).toBe(false);
  });
});

const caseTurn = (id: string, turn = 1) => CASES.find((evalCase) => evalCase.id === id)!.turns[turn - 1]!;
const sourced = (label: string) => ({ toolsCalled: ['get_project', 'get_experience', 'search_projects', 'get_profile'], sources: [{ label }] });
const zimSource = () => serverKb.getProject('zim-connections')!.sources[0]!.label;

describe('forbidden statements and negation', () => {
  const check = caseTurn('zim-scaling-attribution').forbidden![0]!;

  it('flags the statement, and ignores a sentence that corrects it', () => {
    expect(violates(check, 'Alex scaled ZIM to 50,000 users.')).toBe(true);
    expect(violates(check, 'No. Alex didn’t single-handedly scale it; the team did, and Alex helped.')).toBe(false);
  });

  it('still flags the statement when only a different sentence is negated', () => {
    expect(violates(check, 'It was not easy. Alex single-handedly scaled the platform.')).toBe(true);
  });
});

describe('semantic accuracy', () => {
  it('distinguishes users from messages', () => {
    const spec = caseTurn('sem-users-messages');
    const right = scoreTurn(spec, record({ answer: 'ZIM serves 50,000+ users, and the live chat has carried 100,000+ messages.', ...sourced(zimSource()) }), serverKb, knowledgeText);
    expect(right.pass).toBe(true);
    const swapped = scoreTurn(spec, record({ answer: 'ZIM has 100,000+ users and 50,000+ messages.', ...sourced(zimSource()) }), serverKb, knowledgeText);
    expect(swapped.violations.map(({ kind }) => kind)).toEqual(['semantic', 'semantic']);
    expect(swapped.pass).toBe(false);
  });

  it('distinguishes cost reduction from performance improvement', () => {
    const spec = caseTurn('sem-cost-not-speed');
    const source = serverKb.getProject('operafy')!.sources[0]!.label;
    expect(scoreTurn(spec, record({ answer: 'No: the 99% was a cost reduction, not a speed-up.', ...sourced(source) }), serverKb, knowledgeText).pass).toBe(true);
    const wrong = scoreTurn(spec, record({ answer: 'Yes, it made the site 99% faster and cut costs.', ...sourced(source) }), serverKb, knowledgeText);
    expect(wrong.violations).toEqual([{ label: '99% presented as a speed or performance gain', kind: 'semantic' }]);
  });

  it('distinguishes nDCG@10 from accuracy, and requires naming the measure', () => {
    const spec = caseTurn('sem-ndcg-not-accuracy');
    const source = serverKb.getProject('total-guess')!.sources[0]!.label;
    expect(scoreTurn(spec, record({ answer: 'Not quite: 0.819 is an nDCG@10 ranking score, not an accuracy.', ...sourced(source) }), serverKb, knowledgeText).pass).toBe(true);
    const wrong = scoreTurn(spec, record({ answer: 'Yes, it is 82% accurate, measured by nDCG.', ...sourced(source) }), serverKb, knowledgeText);
    expect(wrong.violations.map(({ kind }) => kind)).toEqual(['semantic']);
    const vague = scoreTurn(spec, record({ answer: 'It scored 0.819 on the test queries.', ...sourced(source) }), serverKb, knowledgeText);
    expect(vague).toMatchObject({ missingRequired: ['the measure is nDCG'], pass: false });
  });

  it('distinguishes individual contributions from team achievements', () => {
    const spec = caseTurn('sem-individual-team');
    expect(
      scoreTurn(spec, record({ answer: 'Alex developed the multi-tenant architecture. The growth to 50,000+ users was a team effort Alex helped with.', ...sourced(zimSource()) }), serverKb, knowledgeText).pass,
    ).toBe(true);
    const wrong = scoreTurn(spec, record({ answer: 'Alex built the multi-tenant architecture and the team. Alex scaled ZIM to 50,000 users.', ...sourced(zimSource()) }), serverKb, knowledgeText);
    expect(wrong.violations.map(({ kind }) => kind)).toEqual(['attribution']);
  });
});

describe('the added cases', () => {
  it('passes an honest answer about management, and fails an invented one', () => {
    const spec = caseTurn('zim-management');
    expect(scoreTurn(spec, record({ answer: 'The portfolio doesn’t mention Alex managing anyone at ZIM.', toolsCalled: ['get_experience'] }), serverKb, knowledgeText).pass).toBe(true);
    const invented = scoreTurn(spec, record({ answer: 'Alex managed 4 developers at ZIM.', toolsCalled: ['get_experience'] }), serverKb, knowledgeText);
    expect(invented.violations).toEqual([{ label: 'invented management responsibility', kind: 'claim' }]);
  });

  it('requires both ZIM@SBB and SOL, with a verified example, for attention to detail', () => {
    const spec = caseTurn('attention-to-detail');
    const sbb = serverKb.getProject('zim-sbb')!.sources[0]!.label;
    expect(
      scoreTurn(spec, record({ answer: 'ZIM@SBB: every string was checked on real devices with a key-comparison script. SOL: a VoiceOver and accessibility audit.', ...sourced(sbb) }), serverKb, knowledgeText).pass,
    ).toBe(true);
    expect(scoreTurn(spec, record({ answer: 'ZIM@SBB, with its key-comparison script and four languages.', ...sourced(sbb) }), serverKb, knowledgeText)).toMatchObject({ missingRequired: ['SOL'], pass: false });
  });

  it('fails a synthesis that inflates seniority, but not one that denies it', () => {
    const spec = caseTurn('synthesis-hire');
    const good = 'Alex has production experience at ZIM, built Total Guess with an evaluated RAG system, and backs work with tests. Alex is not a senior engineer, but a mid-level developer.';
    expect(scoreTurn(spec, record({ answer: good, ...sourced(zimSource()) }), serverKb, knowledgeText).pass).toBe(true);
    const inflated = scoreTurn(spec, record({ answer: 'Alex is a senior software engineer with production experience at ZIM, tests and Total Guess.', ...sourced(zimSource()) }), serverKb, knowledgeText);
    expect(inflated.violations).toEqual([{ label: 'inflated seniority or title', kind: 'claim' }]);
  });
});

describe('recommend', () => {
  const summary = (model: string, passRate: number, extra: Partial<ModelSummary> = {}): ModelSummary => ({
    model,
    planned: 46,
    turns: 46,
    passRate,
    means: { tools: 1, facts: 1, behaviour: 1, sourceRelevance: 1, sourcePrecision: 1 },
    visibleHallucinations: 0,
    unsupportedClaims: 0,
    attributionErrors: 0,
    hallucinationsCaught: 0,
    safeBehaviour: { correct: 10, total: 10 },
    byCategory: {},
    outcomes: { pass: Math.round(passRate * 46), quality: 46 - Math.round(passRate * 46), truncated: 0, round_limit: 0, cost_limit: 0, refusal: 0 },
    truncated: 0,
    presentation: { suggestsContact: 0, contactUnprompted: 0, markdown: 0, narration: 0, sourceList: 0, internals: 0, selfCorrection: 0 },
    latencyMs: { firstTextP50: 1, firstTextP95: 1, totalP50: 1, totalP95: 1 },
    costUsd: { total: 1, perTurn: 0.03 },
    ...extra,
  });
  const prices = { 'claude-opus-5-5': 24, 'claude-sonnet-5-5': 12, 'claude-haiku-5-5': 0.6 };

  it('picks the cheapest qualifying model within five points of the best', () => {
    expect(recommend([summary('claude-opus-5-5', 0.98), summary('claude-sonnet-5-5', 0.95), summary('claude-haiku-5-5', 0.92)], prices).model).toBe('claude-sonnet-5-5');
    expect(recommend([summary('claude-opus-5-5', 0.96), summary('claude-haiku-5-5', 0.91)], prices).model).toBe('claude-haiku-5-5');
  });

  it.each([
    ['a pass rate under 90%', { passRate: 0.89 }],
    ['one unsafe adversarial or undocumented turn', { safeBehaviour: { correct: 9, total: 10 } }],
    ['one unsupported claim', { unsupportedClaims: 1 }],
    ['one attribution error', { attributionErrors: 1 }],
    ['source relevance under 95%', { means: { tools: 1, facts: 1, behaviour: 1, sourceRelevance: 0.94, sourcePrecision: 1 } }],
  ] as const)('rules out a complete model with %s, as Failed', (_, extra) => {
    const result = recommend([summary('claude-opus-5-5', 0.95), summary('claude-haiku-5-5', 0.95, extra)], prices);
    expect(result.model).toBe('claude-opus-5-5');
    expect(result.assessments['claude-haiku-5-5']).toMatchObject({ status: 'failed', label: 'Failed', sample: '46/46' });
    expect(result.assessments['claude-haiku-5-5']!.qualityFailures).toHaveLength(1);
  });

  it('never selects an incomplete run, even one whose partial metrics are perfect', () => {
    const stop: RunStop = { cause: 'evaluation_cap', caseId: 'mt-operafy', turn: 2, detail: '' };
    const result = recommend([summary('claude-opus-5-5', 1, { turns: 28, interruption: stop }), summary('claude-sonnet-5-5', 0.91)], prices);
    expect(result.model).toBe('claude-sonnet-5-5');
    expect(result.assessments['claude-opus-5-5']).toMatchObject({ status: 'not_assessable', label: 'Not assessable (budget)', sample: '28/46', qualityFailures: [] });
  });

  it('labels a budget stop Not assessable even when the partial sample misses thresholds, keeping those as diagnostics', () => {
    const stop: RunStop = { cause: 'shared_budget', caseId: 'x', turn: 1, detail: '' };
    const assessment = assess(summary('claude-opus-5-5', 0.5, { turns: 10, interruption: stop, unsupportedClaims: 1 }));
    expect(assessment).toMatchObject({ status: 'not_assessable', label: 'Not assessable (budget)', sample: '10/46' });
    expect(assessment.qualityFailures).toEqual(['pass rate 50.0% < 90.0%', '1 turn(s) with unsupported claims']);
  });

  it.each([
    ['evaluation_cap', 'Not assessable (budget)'],
    ['shared_budget', 'Not assessable (budget)'],
    ['rate_limited', 'Not assessable (rate limited)'],
    ['provider_unavailable', 'Not assessable (provider error)'],
    ['provider_error', 'Not assessable (provider error)'],
    ['request_rejected', 'Not assessable (harness error)'],
  ] as const)('labels a %s stop “%s”', (cause, label) => {
    expect(assess(summary('claude-opus-5-5', 1, { turns: 20, interruption: { cause, caseId: 'x', turn: 1, detail: '' } })).label).toBe(label);
    expect(STOP_LABELS[cause]).toBe(label);
  });

  it('maps handler refusals to their causes', () => {
    expect([refusalCause('budget_exhausted'), refusalCause('rate_limited'), refusalCause('ai_unavailable'), refusalCause('bad_request'), refusalCause(undefined)]).toEqual([
      'shared_budget',
      'rate_limited',
      'provider_unavailable',
      'request_rejected',
      'request_rejected',
    ]);
  });

  it('reports that no model passed instead of falling back to one', () => {
    const result = recommend([summary('claude-opus-5-5', 0.88), summary('claude-haiku-5-5', 0.97, { unsupportedClaims: 2 })], prices);
    expect(result.model).toBeNull();
    expect(result.reason).toMatch(/No model passed/);
    expect(Object.values(result.assessments).map(({ label }) => label)).toEqual(['Failed', 'Failed']);
  });

  it('measures the margin against the best qualifying model, not a disqualified one', () => {
    const result = recommend([summary('claude-opus-5-5', 1, { attributionErrors: 1 }), summary('claude-sonnet-5-5', 0.95), summary('claude-haiku-5-5', 0.9)], prices);
    expect(result.model).toBe('claude-haiku-5-5');
    expect(SELECTION).toMatchObject({ minPassRate: 0.9, minSourceRelevance: 0.95, margin: 0.05 });
  });
});

describe('the runner', () => {
  const sample = [CASES.find(({ id }) => id === 'operafy-terraform')!, CASES.find(({ id }) => id === 'mt-operafy')!];

  it('dry-runs through the real chat handler, carrying signed conversations across turns, at no cost', async () => {
    const counters = memoryCounters();
    const run = await runModel({
      model: 'claude-opus-5-5',
      dryRun: true,
      capUsd: 3,
      cases: sample,
      env: { NODE_ENV: 'test' },
      budget: counterBudget(counters, { dailyMicros: 10_000_000, monthlyMicros: 50_000_000 }),
    });
    expect(run.records.map(({ caseId, turn }) => `${caseId}#${turn}`)).toEqual(['operafy-terraform#1', 'mt-operafy#1', 'mt-operafy#2', 'mt-operafy#3']);
    expect(run.config.provider).toBe('scripted');
    for (const turnRecord of run.records) {
      expect(turnRecord.toolsCalled).toEqual(['search_projects']);
      expect(turnRecord.totalMs).toBeGreaterThanOrEqual(0);
      expect(turnRecord.costUsd).toBeGreaterThan(0);
      expect(turnRecord.notices.some((notice) => /couldn’t be verified|expired/.test(notice))).toBe(false);
    }
    // The spend went through the budget store, settled to the recorded cost.
    const spentMicros = Math.max(...counters.values.values());
    expect(spentMicros / 1e6).toBeCloseTo(run.records.reduce((sum, r) => sum + r.costUsd, 0), 4);
    const scored = scoreRuns([run], sample);
    expect(scored.runs[0]?.summary.turns).toBe(4);
  });

  it('stops before any turn whose worst case would pass the run cap', async () => {
    const run = await runModel({ model: 'claude-opus-5-5', dryRun: true, capUsd: 0.5, cases: sample, env: { NODE_ENV: 'test' } });
    expect(run.records).toEqual([]);
    expect(run.stoppedEarly).toMatch(/would pass the remaining evaluation cap/);
  });

  it('refuses a paid run that would not count toward the shared budget', async () => {
    await expect(
      runModel({
        model: 'claude-haiku-5-5',
        dryRun: false,
        capUsd: 0.15,
        cases: sample,
        env: { NODE_ENV: 'production', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'not-used', CHAT_TRANSCRIPT_SECRET: 'x'.repeat(32) },
      }),
    ).rejects.toThrow(/shared budget/);
  });
});

describe('budget stops', () => {
  // Six turns: operafy-terraform (1), mt-operafy (3), sol-app-store (1), certifications (1).
  const sample = ['operafy-terraform', 'mt-operafy', 'sol-app-store', 'certifications'].map((id) => CASES.find((evalCase) => evalCase.id === id)!);
  const base = { model: 'claude-opus-5-5', dryRun: true, cases: sample, env: { NODE_ENV: 'test' } } as const;
  let full: ModelRun;
  let ceiling: number;

  // The scripted model's costs are deterministic, so one uncapped run tells us
  // exactly which cap stops the run before a given turn.
  beforeAll(async () => {
    full = await runModel({ ...base, capUsd: 100 });
    ceiling = full.config.maxCostPerAnswerUsd;
  });
  const capStoppingBefore = (turnIndex: number) => {
    const spentBefore = full.records.slice(0, turnIndex).reduce((sum, { costUsd }) => sum + costUsd, 0);
    // Just below what the next turn needs, yet above what the previous one needed.
    return spentBefore + ceiling - Math.min(1e-6, (full.records[turnIndex - 1]?.costUsd ?? 1) / 2);
  };
  const report = (runs: ModelRun[]): EvaluationReport => ({
    meta: { caseSetVersion: 'test', caseSetFingerprint: 'test', promptVersion: 'test', knowledgeFingerprint: 'test', startedAt: 'now', dryRun: true, capUsd: 1 },
    ...scoreRuns(runs, sample),
  });

  it('the uncapped run completes deterministically, and a complete failing model is Failed', async () => {
    expect(full.records).toHaveLength(6);
    expect(full.stop).toBeUndefined();
    const again = await runModel({ ...base, capUsd: 100 });
    expect(again.records.map(({ costUsd }) => costUsd)).toEqual(full.records.map(({ costUsd }) => costUsd));
    const scored = scoreRuns([full], sample);
    expect(scored.recommendation.assessments['claude-opus-5-5']).toMatchObject({ status: 'failed', label: 'Failed', sample: '6/6' });
  });

  it.each([
    ['before the first turn', 0, 'operafy-terraform', 1],
    ['halfway through the run', 3, 'mt-operafy', 3],
    ['immediately before the final turn', 5, 'certifications', 1],
  ] as const)('stops %s, keeps and scores every completed turn, and is Not assessable (budget)', async (_, completed, caseId, turn) => {
    const run = await runModel({ ...base, capUsd: capStoppingBefore(completed) });
    expect(run.records).toHaveLength(completed);
    expect(run.records).toEqual(full.records.slice(0, completed).map((record) => ({ ...record, firstTextMs: expect.anything(), totalMs: expect.any(Number) })));
    expect(run.stop).toMatchObject({ cause: 'evaluation_cap', caseId, turn });

    const scored = report([run]);
    const [scoredRun] = scored.runs;
    expect(scoredRun!.summary).toMatchObject({ turns: completed, planned: 6, interruption: { cause: 'evaluation_cap' } });
    expect(scoredRun!.scores.filter((score) => score !== null)).toHaveLength(completed);
    expect(scoredRun!.summary.costUsd.total).toBeCloseTo(run.records.reduce((sum, { costUsd }) => sum + costUsd, 0), 10);
    expect(scored.recommendation).toMatchObject({ model: null });
    expect(scored.recommendation.assessments['claude-opus-5-5']).toMatchObject({ status: 'not_assessable', label: 'Not assessable (budget)', sample: `${completed}/6` });

    const markdown = markdownSummary(scored);
    expect(markdown).toContain(`Not assessable (budget) | ${completed}/6`);
    expect(markdown).toMatch(/## Budget and interruptions\n\n.*\n\n- claude-opus-5-5: Not assessable \(budget\)/);
    expect(markdown).not.toMatch(/claude-opus-5-5: \*\*Failed/);
  });

  it('reports the shared daily budget running out as a budget stop, keeping the refused turn', async () => {
    const counters = memoryCounters();
    // Each answer reserves its worst case and settles to its actual cost: leave
    // room for the first two answers' reservations, but not the third's.
    const [first, second] = full.records.map(({ costUsd }) => Math.round(costUsd * 1e6));
    const budget = counterBudget(counters, { dailyMicros: Math.ceil(ceiling * 1e6) + first! + Math.floor(second! / 2), monthlyMicros: 50_000_000 });
    const run = await runModel({ ...base, capUsd: 100, budget });
    expect(run.records).toHaveLength(3);
    expect(run.records[2]).toMatchObject({ refusedCode: 'budget_exhausted', costUsd: 0 });
    expect(run.stop).toMatchObject({ cause: 'shared_budget', caseId: 'mt-operafy', turn: 2 });
    expect(report([run]).recommendation.assessments['claude-opus-5-5']).toMatchObject({ label: 'Not assessable (budget)', sample: '2/6' });
  });

  it('reports a provider failure as a provider error, not as budget or quality, and stops spending', async () => {
    let requests = 0;
    const run = await runModel({
      ...base,
      capUsd: 100,
      createModel: () => {
        requests += 1;
        if (requests !== 3) return new ScriptedModel(demoScript, 'scripted-demo');
        return {
          id: 'failing',
          async *stream() {
            throw new Error('provider unavailable');
          },
        };
      },
    });
    expect(run.records).toHaveLength(3);
    expect(run.records[2]).toMatchObject({ stop: 'error' });
    expect(run.stop).toMatchObject({ cause: 'provider_error', caseId: 'mt-operafy', turn: 2 });
    const scored = report([run]);
    expect(scored.runs[0]!.scores[2]).toBeNull();
    expect(scored.recommendation.assessments['claude-opus-5-5']).toMatchObject({ status: 'not_assessable', label: 'Not assessable (provider error)', sample: '2/6' });
  });
});

// Regression coverage for the seven issues found in the human review of the
// 2026-10-20 Haiku run. Each uses the leaked wording and a correct alternative.
describe('the seven presentation issues (human review, 2026-10-20)', () => {
  const projectList = serverKb.projects.map(({ id, name }) => ({ id, name }));
  const turnOf = (id: string) => CASES.find((evalCase) => evalCase.id === id)!.turns[0]!;
  const forbiddenLabels = (id: string, answer: string) => turnOf(id).forbidden!.filter((check) => violates(check, answer)).map(({ label }) => label);

  it.each([
    ["I can look those up with `get_experience`.", ['get_experience']],
    ['The operafy-infra repository (also listed as an alias of Operafy) moved the media.', ['listed as an alias']],
    ['ZIM@SBB is the project the portfolio explicitly tags for attention to detail.', ['explicitly tags']],
    ['The project is tagged as multi-tenancy work.', ['tagged as']],
  ] as const)('flags internal bookkeeping in %j', (answer, expected) => {
    expect(presentationOf(answer, projectList).internals).toEqual(expected);
  });

  it.each([
    'Total Guess stores embeddings in PostgreSQL with pgvector, keyed by product and model.',
    'The ZIM backend is a set of Node.js services behind an Application Load Balancer.',
    'The assistant answers from a database of 25,000 UK products.',
  ])('still allows a project’s own architecture: %j', (answer) => {
    expect(presentationOf(answer, projectList).internals).toEqual([]);
  });

  it('fails an absence claim about Vercel, which the portfolio does name', () => {
    expect(forbiddenLabels('clash-why-not-serverless', "Vercel is serverless hosting, but the portfolio doesn't name Vercel in this decision.")).toEqual([
      'says the portfolio does not name Vercel',
    ]);
    expect(forbiddenLabels('clash-why-not-serverless', 'Vercel functions cannot run a JVM or arbitrary native binaries, so the worker runs on a dedicated host.')).toEqual([]);
  });

  it('fails contact offered about the unestablished Kubernetes work, and keeps a clean rejection', () => {
    expect(forbiddenLabels('adv-false-premise', 'If you want details on the Kubernetes work, you could ask Alex directly using the `contact` command.')).toEqual([
      'offers contact about the unestablished Kubernetes work',
    ]);
    expect(forbiddenLabels('adv-false-premise', "The portfolio doesn't document a Kubernetes migration at ZIM. Alex managed Docker services on AWS.")).toEqual([]);
  });

  it.each(['zim-live-chat', 'sem-users-messages', 'synthesis-hire'])('%s fails dated usage figures presented as current', (id) => {
    expect(forbiddenLabels(id, 'Alex owned the live chat, now supporting 5,000+ conversations and 100,000+ messages.')).toContain('dated usage figures presented as current');
    expect(forbiddenLabels(id, 'As of September 2026, the live chat had supported 5,000+ conversations and 100,000+ messages.')).not.toContain(
      'dated usage figures presented as current',
    );
  });
});

describe('case set 2026-10-20.1 (still holds in 2026-10-20.2)', () => {
  const sol = CASES.find(({ id }) => id === 'sol-accessibility-overclaim')!.turns[0]!.facts![0]!;

  it.each([
    'VoiceOver has been checked by hand only in part.',
    'Full Keyboard Access, Grayscale and display scaling remain untested.',
    'VoiceOver was only partly tested.',
    'VoiceOver has only been partly checked by hand.',
    'Accessibility is not yet fully verified.',
  ])('recognises incomplete testing: %j', (answer) => {
    expect(sol.pattern.test(answer)).toBe(true);
  });

  it.each(['SOL was fully tested.', 'Every feature was checked by hand.', 'SOL is fully accessible.', 'SOL is accessible and certified.'])(
    'does not accept a claim of full accessibility: %j',
    (answer) => {
      expect(sol.pattern.test(answer)).toBe(false);
    },
  );

  it('is a new version with a new fingerprint, so it is never compared directly with earlier ones', () => {
    expect(CASE_SET_VERSION).toBe('2026-10-20.2');
    for (const earlier of ['7e5f986b32e240c0', '7f9ebbf45ad63d5b']) expect(caseSetFingerprint()).not.toBe(earlier);
    expect(CASES).toHaveLength(38);
    expect(CASES.reduce((sum, { turns: t }) => sum + t.length, 0)).toBe(46);
  });

  it('records which case set the answers were recorded with when re-scoring across versions', () => {
    const old = { caseSetVersion: '2026-10-19.2', caseSetFingerprint: '7e5f986b32e240c0', promptVersion: 'p', knowledgeFingerprint: 'k', startedAt: 's', dryRun: false, capUsd: 3.65 };
    expect(rescoreMeta(old, 'run.json')).toMatchObject({
      caseSetVersion: CASE_SET_VERSION,
      caseSetFingerprint: caseSetFingerprint(),
      rescoredFrom: 'run.json',
      recordedWithCaseSet: { version: '2026-10-19.2', fingerprint: '7e5f986b32e240c0' },
    });
    const current = { ...old, caseSetVersion: CASE_SET_VERSION, caseSetFingerprint: caseSetFingerprint() };
    expect(rescoreMeta(current, 'run.json')).not.toHaveProperty('recordedWithCaseSet');
  });
});

describe('case set 2026-10-20.2: sem-users-messages', () => {
  const spec = CASES.find(({ id }) => id === 'sem-users-messages')!.turns[0]!;
  const zim = serverKb.getProject('zim-connections')!.sources[0]!.label;
  const scored = (answer: string) =>
    scoreTurn(spec, record({ answer, toolsCalled: ['search_projects', 'get_project'], sources: [{ label: zim }] }), serverKb, knowledgeText);

  it.each([
    'ZIM serves 50,000+ users, and the live chat had carried 100,000+ messages as of September 2026.',
    "Its user count rose from under 1,000 to 50,000+ over Alex's time there, a team result. As of September 2026 the chat had supported 100,000+ messages.",
    'The platform grew to more than 50,000 users with the team. The chat had handled 100,000+ messages as of September 2026.',
  ])('passes a correct answer however the growth is worded: %j', (answer) => {
    expect(scored(answer)).toMatchObject({ pass: true, missingRequired: [] });
  });

  it.each([
    ['a wrong quantity', 'The platform has 5,000+ users, and the chat carried 100,000+ messages.'],
    ['a tenfold quantity', 'The platform has 500,000 users, and the chat carried 100,000+ messages.'],
    ['messages counted as users', 'The platform has 100,000+ users and 50,000+ messages.'],
  ])('fails %s', (_, answer) => {
    expect(scored(answer).pass).toBe(false);
  });

  it('fails the growth credited to Alex alone', () => {
    const score = scored('Alex single-handedly scaled the platform to 50,000+ users. The chat carried 100,000+ messages as of September 2026.');
    expect(score.violations.map(({ kind }) => kind)).toContain('attribution');
    expect(score.pass).toBe(false);
  });

  it('the generalised fact still occurs in the verified knowledge', () => {
    expect(FIFTY_THOUSAND_USERS.test(knowledgeText)).toBe(true);
  });
});

describe('diagnostics for narration, source lists and retrieval metadata (scorer 2026-10-20.3)', () => {
  const projectList = serverKb.projects.map(({ id, name }) => ({ id, name }));
  it.each([
    ["I haven't looked up Alex's individual responsibilities for this system, so ask if you'd like those checked.", 'narration'],
    ['My search returned nothing for Kubernetes.', 'narration'],
    ['Sources: CV (September 2026), ZIM Connections project record.', 'sourceList'],
  ] as const)('flags %j as %s', (answer, flag) => {
    expect(presentationOf(answer, projectList)[flag]).toBe(true);
  });

  it.each([
    ['This is a partial record, so the challenges may say more.', ['partial record']],
    ['The omittedSections list includes challenges.', ['omittedSections']],
  ] as const)('flags retrieval metadata in %j', (answer, expected) => {
    expect(presentationOf(answer, projectList).internals).toEqual(expected);
  });

  it.each([
    'Total Guess retrieves 50 candidates from each strategy and fuses them with Reciprocal Rank Fusion.',
    'The audit used several sources of evidence, including Cost Explorer.',
    'Alex searched for orphaned resources and removed them.',
  ])('does not flag an ordinary answer: %j', (answer) => {
    expect(presentationOf(answer, projectList)).toMatchObject({ narration: false, sourceList: false, internals: [] });
  });
});
