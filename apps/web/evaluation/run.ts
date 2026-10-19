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
import { MODEL_PRICES, PROMPT_VERSION, ScriptedModel, demoScript } from '@portfolio/assistant';
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
import { caseSetFingerprint, recommend, scoreTurn, summarise, type ModelSummary, type Recommendation, type TurnRecord, type TurnScore } from './score';

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
}

export interface ModelRun {
  model: string;
  config: Pick<AiConfig, 'provider' | 'providerModelId' | 'effort' | 'maxOutputTokens' | 'maxInputTokensPerCall' | 'maxRounds' | 'maxCostPerAnswerUsd'>;
  stoppedEarly?: string;
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
  const handle = createChatHandler({
    resolveConfig: () => resolved,
    createModel: (c) => (options.dryRun ? new ScriptedModel(demoScript, 'scripted-demo') : createChatModel(c)),
    budget: () => budget,
    // The evaluation is one operator; visitors' limits don't apply, the budget does.
    limiters: () => ({ minute: memoryLimiter({ requests: 1000, windowSeconds: 60 }), day: memoryLimiter({ requests: 10_000, windowSeconds: 86_400 }) }),
    clientKey: async () => 'evaluation',
    connectMcp: () => connectInProcess(serverKb),
    projects: serverKb.projects.map(({ id, name }) => ({ id, name })),
    log: (event) => {
      if (event.event === 'ai.answer') lastLog = event;
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
    records: [],
  };
  let spent = 0;
  // Each record carries its signed conversation while the case runs; saved results drop it.
  const records: (TurnRecord & { conversation?: Conversation })[] = [];

  outer: for (const evalCase of options.cases ?? CASES) {
    let conversation: Conversation | undefined;
    for (const [index, spec] of evalCase.turns.entries()) {
      if (spent + config.maxCostPerAnswerUsd > options.capUsd) {
        run.stoppedEarly = `Stopped before ${evalCase.id} turn ${index + 1}: its worst case ($${config.maxCostPerAnswerUsd.toFixed(2)}) would pass the remaining cap ($${(options.capUsd - spent).toFixed(2)} of $${options.capUsd.toFixed(2)}).`;
        break outer;
      }
      lastLog = undefined;
      const record = await askOnce(handle, evalCase, index, spec, conversation, () => lastLog);
      spent += record.costUsd;
      records.push(record);
      if (record.refused) {
        run.stoppedEarly = `Stopped at ${evalCase.id} turn ${index + 1}: ${record.refused}`;
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
    return { ...base, answer: '', stop: 'refused', toolsCalled: [], sources: [], projects: [], notices: [], withheldStatements: 0, firstTextMs: null, totalMs: Math.round(performance.now() - started), costUsd: 0, refused: `${refusal.error ?? response.status}: ${refusal.message ?? ''}` };
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
  };
  runs: (ModelRun & { scores: TurnScore[]; summary: ModelSummary })[];
  recommendation: Recommendation;
}

const knowledgeText = JSON.stringify(bundle);

/** Pure: scores recorded runs. Used live and to re-score saved results offline. */
export function scoreRuns(runs: readonly ModelRun[], cases: readonly EvalCase[] = CASES): Pick<EvaluationReport, 'runs' | 'recommendation'> {
  const scoredRuns = runs.map((run) => {
    const scored = run.records.map((record) => {
      const evalCase = cases.find(({ id }) => id === record.caseId);
      const spec = evalCase?.turns[record.turn - 1];
      if (evalCase === undefined || spec === undefined) throw new Error(`No case ${record.caseId} turn ${record.turn}: was this recorded with another case set?`);
      return { evalCase, spec, record, score: scoreTurn(spec, record, serverKb, knowledgeText) };
    });
    return { ...run, scores: scored.map(({ score }) => score), summary: summarise(run.model, scored) };
  });
  const prices = Object.fromEntries(Object.entries(MODEL_PRICES).map(([model, price]) => [model, price.input + price.output]));
  return { runs: scoredRuns, recommendation: recommend(scoredRuns.map(({ summary }) => summary), prices) };
}

export function markdownSummary(report: EvaluationReport): string {
  const pct = (value: number) => `${(value * 100).toFixed(0)}%`;
  const ms = (value: number | null) => (value === null ? 'n/a' : `${(value / 1000).toFixed(1)} s`);
  const lines = [
    `# Evaluation ${report.meta.startedAt}${report.meta.dryRun ? ' (dry run: scripted model)' : ''}`,
    '',
    `Case set ${report.meta.caseSetVersion} (\`${report.meta.caseSetFingerprint}\`) · prompt ${report.meta.promptVersion} · knowledge \`${report.meta.knowledgeFingerprint}\``,
    '',
    '| Model | Pass | Facts | Tools | Sources relevant | Unsupported claims | Attribution errors | Safe behaviour | Caught by gate | First text p50/p95 | Total p50/p95 | Cost |',
    '| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |',
    ...report.runs.map(({ summary: s }) =>
      `| ${s.model} | ${pct(s.passRate)} | ${pct(s.means.facts)} | ${pct(s.means.tools)} | ${pct(s.means.sourceRelevance)} | ${s.unsupportedClaims} | ${s.attributionErrors} | ${s.safeBehaviour.correct}/${s.safeBehaviour.total} | ${s.hallucinationsCaught} | ${ms(s.latencyMs.firstTextP50)} / ${ms(s.latencyMs.firstTextP95)} | ${ms(s.latencyMs.totalP50)} / ${ms(s.latencyMs.totalP95)} | $${s.costUsd.total.toFixed(4)} |`,
    ),
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
    ...Object.entries(report.recommendation.ruledOut).map(([model, failed]) => `- ${model} ruled out: ${failed.join('; ')}.`),
    ...report.runs.flatMap((run) => (run.stoppedEarly ? [`- ${run.model}: ${run.stoppedEarly}`] : [])),
    '',
    '## Turns needing review',
    '',
    ...report.runs.flatMap((run) =>
      run.records.flatMap((record, index) => {
        const score = run.scores[index]!;
        const evalCase = CASES.find(({ id }) => id === record.caseId);
        if (score.pass && !evalCase?.review) return [];
        const problems = [...score.violations.map(({ label, kind }) => `${kind}: ${label}`), ...score.missingRequired.map((label) => `missing: ${label}`), ...score.unsupportedFigures.map((figure) => `unknown figure ${figure}`)];
        return [
          `- **${run.model} · ${record.caseId}#${record.turn}**${score.pass ? '' : ' (failed)'}${problems.length > 0 ? ` [${problems.join('; ')}]` : ''}: ${evalCase?.review ?? ''} Answer: “${record.answer.slice(0, 300)}”`,
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
    const saved = JSON.parse(await readFile(values.rescore, 'utf8')) as EvaluationReport;
    const report = { ...saved, ...scoreRuns(saved.runs) };
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
