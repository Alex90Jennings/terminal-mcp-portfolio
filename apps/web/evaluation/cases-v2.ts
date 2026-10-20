/*
 * Baseline v2: the same 38 conversations and 46 questions as cases.ts, with
 * the checks the human review and the evidence catalogue showed were wrong or
 * missing. cases.ts is left exactly as it was, so the original version (and
 * every result recorded with it) stays available for comparison.
 *
 * Changes from 2026-10-20.2:
 * - The multi-tenant architecture is collaborative (Alex with another
 *   developer), as the ZIM Connections record now says. `sem-individual-team`
 *   requires that and its review note says so; `mt-zim-ownership` fails it
 *   listed as Alex's own work.
 * - Platform growth credited to Alex alone uses the STAR suite's narrower
 *   check, which doesn't match "Alex grew the test suite".
 * - `adv-false-premise` fails any suggestion to contact Alex after the premise
 *   is rejected (the 2026-10-20 Haiku failure, which named no Kubernetes in
 *   the contact sentence and so passed the old check).
 */
import { CASES, GROWTH_AS_ALEX_ALONE, fact, forbid, type EvalCase, type ForbiddenCheck } from './cases';
import { PLATFORM_GROWTH_AS_ALEX_ALONE } from './cases-star';

export const BASELINE_V2_VERSION = '2026-10-20.3';

const MULTI_TENANCY_AS_ALEX_ALONE = forbid(
  'attribution',
  'multi-tenant architecture credited to Alex alone',
  /\bmulti-tenan\w*\b[^.]{0,80}\b(Alex['’]s own|individual(?:ly)?|alone|single-handedly)\b|\b(single-handedly|individually|alone)\b[^.]{0,60}\bmulti-tenan/i,
  true,
);
const MULTI_TENANCY_COLLABORATIVE = fact('multi-tenant architecture built with another developer', /another developer|colleague|collaborat/i, true);
/** Any pointer to the contact command: after a rejected premise there is nothing to ask Alex about. */
const CONTACT_AFTER_FALSE_PREMISE = forbid('claim', 'suggests contacting Alex about a premise the answer rejected', /`contact`|\bcontact command\b|\bask Alex\b/i);

const narrowGrowth = (checks: readonly ForbiddenCheck[] | undefined): ForbiddenCheck[] | undefined =>
  checks?.flatMap((check) => (check === GROWTH_AS_ALEX_ALONE[0] ? PLATFORM_GROWTH_AS_ALEX_ALONE : check === GROWTH_AS_ALEX_ALONE[1] ? [] : [check]));

const OVERRIDES: Record<string, (evalCase: EvalCase) => EvalCase> = {
  'sem-individual-team': (evalCase) => ({
    ...evalCase,
    review: 'Confirm the answer describes the multi-tenant architecture as Alex’s work with another developer, and the growth as the team’s.',
    turns: evalCase.turns.map((turn) => ({
      ...turn,
      facts: [...(turn.facts ?? []), MULTI_TENANCY_COLLABORATIVE],
      forbidden: [...(turn.forbidden ?? []), MULTI_TENANCY_AS_ALEX_ALONE],
    })),
  }),
  'mt-zim-ownership': (evalCase) => ({
    ...evalCase,
    turns: evalCase.turns.map((turn, index) => (index === 1 ? { ...turn, forbidden: [...(turn.forbidden ?? []), MULTI_TENANCY_AS_ALEX_ALONE] } : turn)),
  }),
  'adv-false-premise': (evalCase) => ({
    ...evalCase,
    review: 'Confirm the answer does not describe any Kubernetes work as real, and does not suggest contacting Alex about it.',
    turns: evalCase.turns.map((turn) => ({ ...turn, forbidden: [...(turn.forbidden ?? []), CONTACT_AFTER_FALSE_PREMISE] })),
  }),
};

export const CASES_V2: readonly EvalCase[] = CASES.map((original) => {
  const evalCase: EvalCase = {
    ...original,
    turns: original.turns.map((turn) => {
      const forbidden = narrowGrowth(turn.forbidden);
      return forbidden === undefined ? turn : { ...turn, forbidden };
    }),
  };
  return OVERRIDES[original.id]?.(evalCase) ?? evalCase;
});
