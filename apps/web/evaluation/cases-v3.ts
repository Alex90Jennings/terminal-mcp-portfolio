/*
 * Baseline v3 (2026-10-20.4): the same 46 questions as v1 and v2, derived from
 * v2, which stays exactly as it was. Changes:
 * - `operafy-cost-audit`: "How much did the AWS cost audit save?" can now mean
 *   ZIM's review (about 30%, from Alex's recommendations) or Operafy's audit
 *   (99%), since ZIM's is published. Both, kept apart, or a question back is
 *   correct; one picked silently, or either figure on the wrong project, fails.
 * - The "invented language list" check needs two different language names
 *   (the 2026-10-20 false positive on "Italian … Italian").
 * - `certifications` fails a certification being studied for counted as held
 *   (the 2026-10-20 "holds three AWS certifications").
 * - The ZIM@SBB translation cases fail the key-comparison script or the fixes
 *   credited to Alex (the 2026-10-20 "Alex built a key-comparison script").
 */
import { fact, forbid, type EvalCase, type TurnSpec } from './cases';
import { BOTH_OR_ASKS, OPERAFY_SAVING_AS_30, ZIM_SAVING_AS_99 } from './cases-star';
import { CERTIFICATION_IN_PROGRESS_AS_HELD, DISTINCT_LANGUAGE_LIST } from './cases-star-v2';
import { CASES_V2 } from './cases-v2';

export const BASELINE_V3_VERSION = '2026-10-20.4';

export const SCRIPT_OR_FIXES_AS_ALEX = forbid(
  'attribution',
  'credits the key-comparison script or the fixes to Alex',
  /\bAlex\b[^.]{0,20}\b(built|wrote|created|developed|made)\b[^.]{0,20}\b(key-comparison )?script\b|\bAlex\b[^.]{0,20}\b(fixed|corrected|implemented the fix(es)?)\b[^.]{0,30}\b(both|them|defects?|keys?|button)\b/i,
  true,
);

const withForbidden = (extra: ReturnType<typeof forbid>[]) => (turn: TurnSpec): TurnSpec => ({ ...turn, forbidden: [...(turn.forbidden ?? []), ...extra] });

const OVERRIDES: Record<string, (evalCase: EvalCase) => EvalCase> = {
  'operafy-cost-audit': (evalCase) => ({
    ...evalCase,
    projects: ['operafy', 'zim-connections'],
    review: 'Confirm the answer keeps ZIM (about 30%, Alex researched and recommended) apart from Operafy (99%, Alex’s own audit), or asks which is meant.',
    turns: evalCase.turns.map((turn) => ({
      ...turn,
      tools: [['get_project', 'search_projects', 'get_examples']],
      facts: [BOTH_OR_ASKS, fact('Operafy: 99%', /99\s?%/)],
      forbidden: [...(turn.forbidden ?? []), ZIM_SAVING_AS_99, OPERAFY_SAVING_AS_30],
      projects: ['operafy', 'zim-connections'],
    })),
  }),
  certifications: (evalCase) => ({ ...evalCase, turns: evalCase.turns.map(withForbidden([CERTIFICATION_IN_PROGRESS_AS_HELD])) }),
  'sbb-localisation': (evalCase) => ({ ...evalCase, turns: evalCase.turns.map(withForbidden([SCRIPT_OR_FIXES_AS_ALEX])) }),
  'sbb-ai-translations': (evalCase) => ({ ...evalCase, turns: evalCase.turns.map(withForbidden([SCRIPT_OR_FIXES_AS_ALEX])) }),
  'attention-to-detail': (evalCase) => ({ ...evalCase, turns: evalCase.turns.map(withForbidden([SCRIPT_OR_FIXES_AS_ALEX])) }),
};

export const CASES_V3: readonly EvalCase[] = CASES_V2.map((v2) => {
  const evalCase: EvalCase = {
    ...v2,
    turns: v2.turns.map((turn) => ({
      ...turn,
      ...(turn.forbidden && { forbidden: turn.forbidden.map((check) => (check.label === 'invented language list' ? DISTINCT_LANGUAGE_LIST : check)) }),
    })),
  };
  return OVERRIDES[v2.id]?.(evalCase) ?? evalCase;
});
