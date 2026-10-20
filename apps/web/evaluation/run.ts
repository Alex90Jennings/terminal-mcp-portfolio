/**
 * Runs the evaluation through the real /api/chat handler, in-process: the
 * same rate limits, budget reservation, sentence gate and transcript signing
 * visitors get. Paid runs spend from the shared Upstash budget, so they count
 * toward the $10/day and $50/month caps.
 *
 *   npm run eval -- --dry-run                       # scripted model, no cost, no credentials
 *   npm run eval -- --models claude-haiku-5-5       # paid: needs AI_PROVIDER, provider credentials and Upstash
 *   npm run eval -- --rescore evaluation/results/x.json
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { MODEL_PRICES, PROMPT_VERSION, ScriptedModel, demoScript, type ChatModel } from '@portfolio/assistant';
import bundle from '@portfolio/knowledge/bundle.json' with { type: 'json' };
import { connectInProcess } from '@portfolio/mcp-server';
import { createHash } from 'node:crypto';
import { parseSse, type ChatStreamEvent, type Conversation } from '../src/lib/chat-client';
import { counterBudget, createBudgetStore, memoryCounters, toMicros, type BudgetStore } from '../src/server/ai/budget';
import { resolveAiConfig, type AiConfig } from '../src/server/ai/config';
import { createChatHandler } from '../src/server/ai/handler';
import { createChatModel } from '../src/server/ai/provider';
import { serverKb } from '../src/server/knowledge';
import { memoryLimiter, resolveBackend } from '../src/server/rate-limit';
import { CASE_SET_VERSION, CASES, type EvalCase, type TurnSpec } from './cases';
import {
  SCORER_VERSION,
  STOP_LABELS,
  caseSetFingerprint,
  isCompletedTurn,
  recommend,
  refusalCause,
  scoreTurn,
  summarise,
  type ModelSummary,
  type Recommendation,
  type RunStop,
  type TurnRecord,
  type TurnScore,
} from './score';

export const DEFAULT_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'] as const;

/**
 * The most one evaluation may spend across every model, on top of the shared
 * daily and monthly budget. Models run in order and share it: a turn only
 * starts if everything spent so far plus that turn's worst case fits.
 */
export const EVALUATION_CAP_USD = 3.65;

export interface RunOptions {
  model: string;
  dryRun: boolean;
  /** What this run may spend: the evaluation cap less what earlier models spent. */
  capUsd: number;
  cases?: readonly EvalCase[];
  env?: Record<string, string | undefined>;
  /** Injected in tests; defaults to the shared store (Upstash) for paid runs. */
  budget?: BudgetStore;
  /** Injected in tests; defaults to the scripted model for dry runs and the configured provider otherwise. */
  createModel?: (config: AiConfig) => ChatModel;
}

export interface ModelRun {
  model: string;
  config: Pick<AiConfig, 'provider' | 'providerModelId' | 'effort' | 'maxOutputTokens' | 'maxInputTokensPerCall' | 'maxRounds' | 'maxCostPerAnswerUsd'>;
  /** Why the run stopped before its last turn, if it did. */
  stop?: RunStop;
  /** The same, for people. */
  stoppedEarly?: string;
  /** Turns in the case set the run was given. */
  planned: number;
  /** Every turn that ran, including refused and provider-failed ones, with what each cost. */
  records: TurnRecord[];
}

const ORIGIN = 'https://evaluation.local';

export async function runModel(options: RunOptions): Promise<ModelRun> {
  const env = { ...(options.env ?? process.env), AI_MODEL: options.model, ...(options.dryRun && { AI_PROVIDER: 'scripted' }) };
  const resolved = resolveAiConfig(env);
  if (!resolved.ok) throw new Error(`AI configuration for ${options.model} is unavailable: ${resolved.reason}`);
  const config = resolved.config;

  let budget = options.budget;
  if (budget === undefined) {
    if (options.dryRun) {
      budget = counterBudget(memoryCounters(), { dailyMicros: toMicros(config.dailyBudgetUsd), monthlyMicros: toMicros(config.monthlyBudgetUsd) });
    } else {
      // Paid runs must count toward the shared caps: never an in-process budget.
      const sharedEnv = { ...env, RATE_LIMIT_BACKEND: 'upstash' };
      if (resolveBackend(sharedEnv).kind !== 'upstash') {
        throw new Error('A paid evaluation must spend from the shared budget: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
      }
      budget = createBudgetStore({ dailyUsd: config.dailyBudgetUsd, monthlyUsd: config.monthlyBudgetUsd }, sharedEnv);
    }
  }

  let lastLog: Record<string, unknown> | undefined;
  // Filled by `inspect` while a turn runs: an object, so the compiler doesn't narrow it away.
  const inspected: { withheld?: { text: string; figures: string[] }[] } = {};
  const takeWithheld = () => {
    const { withheld } = inspected;
    delete inspected.withheld;
    return withheld;
  };
  const handle = createChatHandler({
    resolveConfig: () => resolved,
    createModel: options.createModel ?? ((c) => (options.dryRun ? new ScriptedModel(demoScript, 'scripted-demo') : createChatModel(c))),
    budget: () => budget,
    // The evaluation is one operator; visitors' limits don't apply, the budget does.
    limiters: () => ({ minute: memoryLimiter({ requests: 1000, windowSeconds: 60 }), day: memoryLimiter({ requests: 10_000, windowSeconds: 86_400 }) }),
    clientKey: async () => 'evaluation',
    connectMcp: () => connectInProcess(serverKb),
    projects: serverKb.projects.map(({ id, name }) => ({ id, name })),
    log: (event) => {
      if (event.event === 'ai.answer') lastLog = event;
    },
    inspect: (outcome) => {
      inspected.withheld = outcome.withheld.map(({ text, figures }) => ({ text, figures: [...figures] }));
    },
  });

  const run: ModelRun = {
    model: options.model,
    config: {
      provider: config.provider,
      providerModelId: config.providerModelId,
      effort: config.effort,
      maxOutputTokens: config.maxOutputTokens,
      maxInputTokensPerCall: config.maxInputTokensPerCall,
      maxRounds: config.maxRounds,
      maxCostPerAnswerUsd: config.maxCostPerAnswerUsd,
    },
    planned: (options.cases ?? CASES).reduce((sum, { turns }) => sum + turns.length, 0),
    records: [],
  };
  const stopAt = (stop: RunStop) => {
    run.stop = stop;
    run.stoppedEarly = `${STOP_LABELS[stop.cause]}: stopped at ${stop.caseId} turn ${stop.turn}. ${stop.detail}`;
  };
  let spent = 0;
  // Each record carries its signed conversation while the case runs; saved results drop it.
  const records: (TurnRecord & { conversation?: Conversation })[] = [];

  outer: for (const evalCase of options.cases ?? CASES) {
    let conversation: Conversation | undefined;
    for (const [index, spec] of evalCase.turns.entries()) {
      if (spent + config.maxCostPerAnswerUsd > options.capUsd) {
        stopAt({
          cause: 'evaluation_cap',
          caseId: evalCase.id,
          turn: index + 1,
          detail: `Its worst case ($${config.maxCostPerAnswerUsd.toFixed(2)}) would pass the remaining evaluation cap ($${(options.capUsd - spent).toFixed(2)} of $${options.capUsd.toFixed(2)}).`,
        });
        break outer;
      }
      lastLog = undefined;
      takeWithheld();
      const record = await askOnce(handle, evalCase, index, spec, conversation, () => lastLog);
      const withheld = takeWithheld();
      if (withheld !== undefined && withheld.length > 0) record.withheld = withheld;
      spent += record.costUsd;
      records.push(record);
      if (record.refused !== undefined) {
        stopAt({ cause: refusalCause(record.refusedCode), caseId: evalCase.id, turn: index + 1, detail: `Refused: ${record.refused}` });
        break outer;
      }
      if (!isCompletedTurn(record)) {
        // The run can no longer be complete, so further turns would only spend.
        stopAt({ cause: 'provider_error', caseId: evalCase.id, turn: index + 1, detail: `The provider failed while answering (stop: ${record.stop}).` });
        break outer;
      }
      conversation = record.conversation;
    }
  }
  run.records = records.map(({ conversation: _conversation, ...record }) => record);
  return run;
}

async function askOnce(
  handle: (request: Request) => Promise<Response>,
  evalCase: EvalCase,
  index: number,
  spec: TurnSpec,
  conversation: Conversation | undefined,
  log: () => Record<string, unknown> | undefined,
): Promise<TurnRecord & { conversation?: Conversation }> {
  const started = performance.now();
  const response = await handle(
    new Request(`${ORIGIN}/api/chat`, {
      method: 'POST',
      headers: { Origin: ORIGIN, Host: new URL(ORIGIN).host, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: spec.question, ...(conversation && { conversation }) }),
    }),
  );
  const base = { caseId: evalCase.id, turn: index + 1, question: spec.question };
  if (!response.ok) {
    const refusal = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    return {
      ...base,
      answer: '',
      stop: 'refused',
      toolsCalled: [],
      sources: [],
      projects: [],
      notices: [],
      withheldStatements: 0,
      firstTextMs: null,
      totalMs: Math.round(performance.now() - started),
      costUsd: 0,
      refused: `${refusal.error ?? response.status}: ${refusal.message ?? ''}`,
      ...(refusal.error !== undefined && { refusedCode: refusal.error }),
    };
  }

  const events: ChatStreamEvent[] = [];
  let firstTextMs: number | null = null;
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const parsed = parseSse(buffer + value);
    buffer = parsed.rest;
    for (const event of parsed.events) {
      if (event.type === 'text' && firstTextMs === null) firstTextMs = Math.round(performance.now() - started);
      events.push(event);
    }
  }
  const totalMs = Math.round(performance.now() - started);
  const done = events.find((event): event is Extract<ChatStreamEvent, { type: 'done' }> => event.type === 'done');
  const logged = log();
  return {
    ...base,
    answer: done?.answer ?? '',
    stop: done?.stop ?? 'error',
    toolsCalled: [...new Set(events.flatMap((event) => (event.type === 'tool' && event.status !== 'running' ? [event.name] : [])))],
    toolLabels: events.flatMap((event) => (event.type === 'tool' && event.status !== 'running' ? [`${event.label}${event.status === 'error' ? ' (error)' : ''}`] : [])),
    sources: done?.sources ?? [],
    projects: done?.projects ?? [],
    notices: events.flatMap((event) => (event.type === 'notice' ? [event.message] : [])),
    withheldStatements: done?.withheldStatements ?? 0,
    firstTextMs,
    totalMs,
    costUsd: typeof logged?.costUsd === 'number' ? logged.costUsd : 0,
    ...(logged?.usage !== undefined && { usage: logged.usage as NonNullable<TurnRecord['usage']> }),
    ...(done?.conversation && { conversation: done.conversation }),
  };
}

export interface EvaluationReport {
  meta: {
    caseSetVersion: string;
    caseSetFingerprint: string;
    promptVersion: string;
    knowledgeFingerprint: string;
    startedAt: string;
    dryRun: boolean;
    capUsd: number;
    /** Absent in results scored before scorer versions were recorded (2026-10-19.1). */
    scorerVersion?: string;
    /** Set on a re-score: the file it was re-scored from, left unchanged. */
    rescoredFrom?: string;
  };
  /** `scores` lines up with `records`; null for a turn that was refused or failed at the provider. */
  runs: (ModelRun & { scores: (TurnScore | null)[]; summary: ModelSummary })[];
  recommendation: Recommendation;
}

const knowledgeText = JSON.stringify(bundle);

/** Pure: scores recorded runs. Used live and to re-score saved results offline. */
export function scoreRuns(runs: readonly ModelRun[], cases: readonly EvalCase[] = CASES): Pick<EvaluationReport, 'runs' | 'recommendation'> {
  const planned = cases.reduce((sum, { turns }) => sum + turns.length, 0);
  const scoredRuns = runs.map((run) => {
    const scored = run.records.map((record) => {
      const evalCase = cases.find(({ id }) => id === record.caseId);
      const spec = evalCase?.turns[record.turn - 1];
      if (evalCase === undefined || spec === undefined) throw new Error(`No case ${record.caseId} turn ${record.turn}: was this recorded with another case set?`);
      return isCompletedTurn(record) ? { evalCase, spec, record, score: scoreTurn(spec, record, serverKb, knowledgeText) } : null;
    });
    const completed = scored.filter((entry) => entry !== null);
    const summary = summarise(run.model, completed, {
      planned: run.planned ?? planned,
      spentUsd: run.records.reduce((sum, { costUsd }) => sum + costUsd, 0),
      interruption: run.stop ?? legacyStop(run),
    });
    return { ...run, scores: scored.map((entry) => entry?.score ?? null), summary };
  });
  const prices = Object.fromEntries(Object.entries(MODEL_PRICES).map(([model, price]) => [model, price.input + price.output]));
  return { runs: scoredRuns, recommendation: recommend(scoredRuns.map(({ summary }) => summary), prices) };
}

/** Classifies a stop recorded before stops carried a cause, so older results re-score the same way. */
function legacyStop(run: ModelRun): RunStop | undefined {
  if (run.stoppedEarly === undefined) return undefined;
  const last = run.records.at(-1);
  const refusedCode = last?.refusedCode ?? last?.refused?.split(':')[0];
  const cause = /cap/.test(run.stoppedEarly) ? 'evaluation_cap' : last?.refused !== undefined ? refusalCause(refusedCode) : 'provider_error';
  return { cause, caseId: last?.caseId ?? '', turn: last?.turn ?? 0, detail: run.stoppedEarly };
}

export function markdownSummary(report: EvaluationReport): string {
  const pct = (value: number) => `${(value * 100).toFixed(0)}%`;
  const ms = (value: number | null) => (value === null ? 'n/a' : `${(value / 1000).toFixed(1)} s`);
  const lines = [
    `# Evaluation ${report.meta.startedAt}${report.meta.dryRun ? ' (dry run: scripted model)' : ''}`,
    '',
    `Case set ${report.meta.caseSetVersion} (\`${report.meta.caseSetFingerprint}\`) · prompt ${report.meta.promptVersion} · knowledge \`${report.meta.knowledgeFingerprint}\` · scorer ${report.meta.scorerVersion ?? '2026-10-19.1'}${report.meta.rescoredFrom ? ` (re-scored offline from \`${report.meta.rescoredFrom}\`)` : ''}`,
    '',
    '| Model | Status | Sample | Pass | Facts | Tools | Sources relevant | Unsupported claims | Attribution errors | Safe behaviour | Caught by gate | First text p50/p95 | Total p50/p95 | Cost |',
    '| :-- | :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |',
    ...report.runs.map(({ summary: s }) => {
      const assessment = report.recommendation.assessments[s.model];
      const partial = s.interruption !== undefined ? '*' : '';
      return `| ${s.model} | ${assessment?.label ?? ''} | ${s.turns}/${s.planned} | ${pct(s.passRate)}${partial} | ${pct(s.means.facts)}${partial} | ${pct(s.means.tools)}${partial} | ${pct(s.means.sourceRelevance)}${partial} | ${s.unsupportedClaims}${partial} | ${s.attributionErrors}${partial} | ${s.safeBehaviour.correct}/${s.safeBehaviour.total}${partial} | ${s.hallucinationsCaught} | ${ms(s.latencyMs.firstTextP50)} / ${ms(s.latencyMs.firstTextP95)} | ${ms(s.latencyMs.totalP50)} / ${ms(s.latencyMs.totalP95)} | $${s.costUsd.total.toFixed(4)} |`;
    }),
    ...(report.runs.some(({ summary }) => summary.interruption !== undefined)
      ? ['', '\\* Partial: computed from the completed turns only, for diagnosis. An incomplete run is never selected.']
      : []),
    '',
    ...report.runs.map(({ summary: s }) => {
      const failures = Object.entries(s.outcomes).filter(([outcome, count]) => outcome !== 'pass' && count > 0);
      return `- ${s.model} failed turns by cause: ${failures.length === 0 ? 'none' : failures.map(([outcome, count]) => `${outcome} ${count}`).join(', ')}; answers cut off by the output limit: ${s.truncated}. Diagnostics: ${s.presentation.suggestsContact} answers suggest \`contact\` (${s.presentation.contactUnprompted ?? 'n/a'} unprompted), ${s.presentation.markdown ?? 'n/a'} use Markdown, ${s.presentation.internals} show internal identifiers, ${s.presentation.selfCorrection} narrate a self-correction.`;
    }),
    '',
    `Total spent: $${report.runs.reduce((sum, { summary }) => sum + summary.costUsd.total, 0).toFixed(4)} of the $${report.meta.capUsd.toFixed(2)} cap.`,
    '',
    ...(report.meta.dryRun
      ? ['_Dry run: answers come from the scripted search, and costs are notional (estimated tokens × each model’s prices). Nothing was spent._', '']
      : []),
    report.recommendation.model === null
      ? `**Recommendation: no model passed.** ${report.recommendation.reason}`
      : `**Recommendation:** ${report.recommendation.model}. ${report.recommendation.reason}`,
    '',
    '## Model quality',
    '',
    ...Object.entries(report.recommendation.assessments).map(([model, a]) =>
      a.status === 'failed'
        ? `- ${model}: **Failed** on ${a.sample} turns: ${a.qualityFailures.join('; ')}.`
        : a.status === 'qualified'
          ? `- ${model}: **Qualified** on ${a.sample} turns.`
          : `- ${model}: **${a.label}** on ${a.sample} turns; quality not judged.${a.qualityFailures.length > 0 ? ` Diagnostic only, from the partial sample: ${a.qualityFailures.join('; ')}.` : ''}`,
    ),
    '',
    '## Budget and interruptions',
    '',
    'Kept apart from quality: these say why a run stopped, not how well the model answered.',
    '',
    ...(report.runs.some((run) => run.stoppedEarly !== undefined)
      ? report.runs.flatMap((run) => (run.stoppedEarly !== undefined ? [`- ${run.model}: ${run.stoppedEarly} Spent $${run.summary.costUsd.total.toFixed(4)}.`] : []))
      : ['- None: every run completed.']),
    '',
    '## Turns needing review',
    '',
    ...report.runs.flatMap((run) =>
      run.records.flatMap((record, index) => {
        const score = run.scores[index];
        if (score === null || score === undefined) return [];
        const evalCase = CASES.find(({ id }) => id === record.caseId);
        if (score.pass && !evalCase?.review) return [];
        const problems = [...score.violations.map(({ label, kind }) => `${kind}: ${label}`), ...score.missingRequired.map((label) => `missing: ${label}`), ...score.unsupportedFigures.map((figure) => `unknown figure ${figure}`)];
        return [
          `- **${run.model} · ${record.caseId}#${record.turn}**${score.pass ? '' : ` (failed: ${score.outcome})`}${problems.length > 0 ? ` [${problems.join('; ')}]` : ''}: ${evalCase?.review ?? ''} Answer: “${record.answer.slice(0, 300)}”`,
        ];
      }),
    ),
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const { values } = parseArgs({
    options: {
      models: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      out: { type: 'string' },
      rescore: { type: 'string' },
    },
  });
  const outDir = path.resolve(import.meta.dirname, values.out ?? 'results');

  if (values.rescore) {
    // Offline: no model calls. The original file is left as it is; the re-score is written beside it.
    const saved = JSON.parse(await readFile(values.rescore, 'utf8')) as EvaluationReport;
    const report: EvaluationReport = {
      ...saved,
      meta: { ...saved.meta, scorerVersion: SCORER_VERSION, rescoredFrom: path.basename(values.rescore) },
      ...scoreRuns(saved.runs),
    };
    const stem = values.rescore.replace(/\.json$/, `.rescored-${SCORER_VERSION}`);
    await writeFile(`${stem}.json`, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(`${stem}.md`, markdownSummary(report));
    console.log(markdownSummary(report));
    return;
  }

  const models = values.models?.split(',').map((model) => model.trim()) ?? [...DEFAULT_MODELS];
  const dryRun = values['dry-run'] ?? false;
  const meta: EvaluationReport['meta'] = {
    caseSetVersion: CASE_SET_VERSION,
    caseSetFingerprint: caseSetFingerprint(),
    promptVersion: PROMPT_VERSION,
    knowledgeFingerprint: createHash('sha256').update(knowledgeText).digest('hex').slice(0, 16),
    startedAt: new Date().toISOString(),
    dryRun,
    capUsd: EVALUATION_CAP_USD,
    scorerVersion: SCORER_VERSION,
  };
  await mkdir(outDir, { recursive: true });
  const stem = `${meta.startedAt.replace(/[:.]/g, '-')}${dryRun ? '-dry-run' : ''}`;
  const save = async (runs: readonly ModelRun[]) => {
    const report: EvaluationReport = { meta, ...scoreRuns(runs) };
    await writeFile(path.join(outDir, `${stem}.json`), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(path.join(outDir, `${stem}.md`), markdownSummary(report));
    return report;
  };

  const runs: ModelRun[] = [];
  let spent = 0;
  for (const model of models) {
    console.error(`[eval] ${model}${dryRun ? ' (dry run)' : ''}: $${(EVALUATION_CAP_USD - spent).toFixed(2)} of the cap left…`);
    const run = await runModel({ model, dryRun, capUsd: EVALUATION_CAP_USD - spent });
    spent += run.records.reduce((sum, { costUsd }) => sum + costUsd, 0);
    runs.push(run);
    // Saved after every model, so a later failure never loses paid results.
    await save(runs);
  }
  console.log(markdownSummary(await save(runs)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
