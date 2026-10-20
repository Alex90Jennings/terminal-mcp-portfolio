/*
 * STAR suite star-2026-10-20.6: star-2026-10-20.5 (cases-star-v2.ts, left
 * exactly as it was so its recorded results can be re-scored), for prompt
 * 2026-10-20.10, which tells an example as one paragraph instead of labelled
 * lines.
 *
 * Changes:
 * - The required "told as Situation, Task, Action, Result" fact is gone.
 * - Every turn that required it now fails part labels ("Situation:",
 *   "Result:") or naming the STAR method instead.
 * - `star-hard-problem` accepts "0.5 to 1.5 seconds" as well as "0.5–1.5
 *   seconds" (the 2026-10-20 false negative, S3).
 */
import { fact, forbid, type EvalCase, type TurnSpec } from './cases';
import { STAR_V2_CASES } from './cases-star-v2';

export const STAR_V3_CASE_SET_VERSION = 'star-2026-10-20.6';

const STAR_FORMAT_LABEL = 'told as Situation, Task, Action, Result';

export const LABELLED_PARTS = forbid('semantic', 'labels the parts of the example or names the STAR method', /\b(Situation|Task|Action|Result|Reflection)\s*:|\bSTAR\b/);

const asOneParagraph = (turn: TurnSpec): TurnSpec =>
  turn.facts?.some(({ label }) => label === STAR_FORMAT_LABEL)
    ? { ...turn, facts: turn.facts.filter(({ label }) => label !== STAR_FORMAT_LABEL), forbidden: [...(turn.forbidden ?? []), LABELLED_PARTS] }
    : turn;

const HARD_PROBLEM_OUTCOME = fact(
  'a documented example with its outcome',
  /0\.5\s?(?:[–-]|to)\s?1\.5 seconds|numeric owner and repository IDs|more advantageous eligible discount|larger eligible discount/i,
  true,
);

const withSpelledRange = (turn: TurnSpec): TurnSpec =>
  turn.facts === undefined ? turn : { ...turn, facts: turn.facts.map((check) => (check.label === HARD_PROBLEM_OUTCOME.label ? HARD_PROBLEM_OUTCOME : check)) };

export const STAR_V3_CASES: readonly EvalCase[] = STAR_V2_CASES.map((evalCase) => {
  const turns = evalCase.turns.map(asOneParagraph);
  return { ...evalCase, turns: evalCase.id === 'star-hard-problem' ? turns.map(withSpelledRange) : turns };
});
