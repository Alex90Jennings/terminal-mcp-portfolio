/*
 * STAR suite star-2026-10-20.5: star-2026-10-20.4 (cases-star.ts, left exactly
 * as it was so its recorded results can be re-scored) with the scorer errors
 * found in the 2026-10-20 human review fixed, and the interview questions from
 * the original scope added.
 *
 * Fixes (each was a correct answer scored wrongly, or the reverse):
 * - `star-sbb-languages`: the language-list check needs two different names;
 *   "Italian … Italian" no longer counts as a list.
 * - `star-mt-collaboration`: "another developer" is a collaboration example.
 * - `star-mt-live-chat`: any documented project owned end to end, found with
 *   any project tool, is a correct first answer.
 * - `star-sns-percentage`: only a percentage tied to the SNS migration is an
 *   invented saving; Operafy's 99%, correctly attributed, is not.
 * - `star-decisions`: any documented decision counts, and saying no
 *   decision-making example exists fails (the genuine 2026-10-20 failure).
 * Source relevance (scorer 2026-10-20.4) counts a story's own sources.
 */
import { INVENTED_MANAGEMENT, fact, forbid, type EvalCase, type TurnSpec } from './cases';
import { PLATFORM_GROWTH_AS_ALEX_ALONE, STAR_CASES } from './cases-star';

export const STAR_V2_CASE_SET_VERSION = 'star-2026-10-20.5';

const ADJECTIVES = forbid('claim', 'asserts a strength instead of showing it', /\b(excellent|outstanding|exceptional|natural) (communicator|leader|problem-solver|collaborator)\b/i, true);
const STAR_FORMAT = fact('told as Situation, Task, Action, Result', /Situation:[\s\S]*Task:[\s\S]*Action:[\s\S]*Result:/i, true);
const EXAMPLES = [['get_examples', 'get_skills']];
const ANY_PROJECT_TOOL = [['get_examples', 'get_project', 'search_projects', 'get_skills']];
const PROFILE = [['get_profile', 'get_experience']];

/** Two different language names: one language named twice is not a list. */
export const DISTINCT_LANGUAGE_LIST = forbid(
  'claim',
  'invented language list',
  /\b(German|French|Italian|Romansh|English)\b[^.]*\b(?!\1\b)(German|French|Italian|Romansh|English)\b/i,
);
export const SNS_SAVING = forbid(
  'claim',
  'an invented saving for the SNS migration',
  /\b(SNS|notifications?|Firebase)\b[^.]{0,80}\d+\s?%|\d+\s?%[^.]{0,80}\b(SNS|notifications?|Firebase)\b/i,
  true,
);
export const NO_DECISION_EXAMPLE = forbid(
  'claim',
  'says no decision-making example exists',
  /\bno\b[^.]{0,80}\bexamples?\b[^.]{0,40}\bdecision|\bdecision[^.]{0,60}\bno\b[^.]{0,30}\bexamples?\b/i,
);
export const STILL_AT_ZIM = forbid(
  'claim',
  'presents Alex as still employed at ZIM',
  /\b(currently|now|still)\b[^.]{0,40}\b(works?|working|employed)\b[^.]{0,40}\bZIM\b|\bAlex (is|works) (a [^.]{0,40})?at ZIM\b/i,
  true,
);
export const CERTIFICATION_IN_PROGRESS_AS_HELD = forbid(
  'claim',
  'counts a certification being studied for as held',
  /\b(three|3)\s+(AWS\s+)?certifications?\b|\b(holds?|has earned|earned|achieved)\s+(the\s+)?(AWS\s+)?(Certified\s+)?Solutions Architect/i,
  true,
);
const DEGREE_AS_COMPLETED = forbid(
  'claim',
  'presents the apprenticeship degree as completed',
  /\b(completed|finished|graduated from|has a|holds? a)\b[^.]{0,40}\b(apprenticeship|Digital (&|and) Technology Solutions)\b/i,
  true,
);

const narrowLanguages = (turn: TurnSpec): TurnSpec =>
  turn.forbidden === undefined ? turn : { ...turn, forbidden: turn.forbidden.map((check) => (check.label === 'invented language list' ? DISTINCT_LANGUAGE_LIST : check)) };

const FIXES: Record<string, (evalCase: EvalCase) => EvalCase> = {
  'star-sbb-languages': (evalCase) => ({ ...evalCase, turns: evalCase.turns.map(narrowLanguages) }),
  'star-mt-collaboration': (evalCase) => ({
    ...evalCase,
    turns: evalCase.turns.map((turn) => ({
      ...turn,
      facts: [fact('a collaboration example', /another developer|colleague|product team|product stakeholders/i, true)],
    })),
  }),
  'star-mt-live-chat': (evalCase) => ({
    ...evalCase,
    review: 'Any documented project Alex owned end to end is correct; confirm the follow-ups stay on the same project.',
    turns: evalCase.turns.map((turn, index) => (index === 0 ? { ...turn, tools: ANY_PROJECT_TOOL } : turn)),
  }),
  'star-sns-percentage': (evalCase) => ({ ...evalCase, turns: evalCase.turns.map((turn) => ({ ...turn, forbidden: [SNS_SAVING] })) }),
  'star-decisions': (evalCase) => ({
    ...evalCase,
    turns: evalCase.turns.map((turn) => ({
      ...turn,
      tools: ANY_PROJECT_TOOL,
      facts: [
        fact(
          'a documented decision',
          /configuration rather than|cost, reliability, scalability|dedicated|WebSockets|multi-tenan|SNS|Terraform|OIDC|Mann[–-]Whitney|median|labelled|pgvector|Lambda and SQS/i,
          true,
        ),
      ],
      forbidden: [ADJECTIVES, NO_DECISION_EXAMPLE],
    })),
  }),
};

/** The original scope's interview questions: about Alex, answered from evidence, never invented. */
const INTERVIEW: EvalCase[] = [
  {
    id: 'int-about',
    stories: ['from-finance', 'small-teams'],
    category: 'synthesis',
    projects: [],
    review: 'Confirm a short, evidence-based introduction that doesn’t present Alex as still at ZIM.',
    turns: [{ question: 'Tell me about Alex.', expect: 'answer', tools: PROFILE, facts: [fact('a software developer', /software developer|full[- ]stack/i, true)], forbidden: [ADJECTIVES, STILL_AT_ZIM] }],
  },
  {
    id: 'int-why-software',
    stories: ['from-finance'],
    category: 'behavioural',
    projects: [],
    turns: [
      {
        question: 'Why did Alex become a software engineer?',
        expect: 'answer',
        tools: PROFILE,
        facts: [fact('came from economics and finance', /finance|economics/i, true), fact('enjoys building products people use', /build|product/i)],
        forbidden: [ADJECTIVES],
      },
    ],
  },
  {
    id: 'int-strengths',
    stories: ['zim-live-chat', 'zim-test-gate', 'zim-multi-tenancy'],
    category: 'synthesis',
    projects: [],
    review: 'Confirm strengths are shown through evidence, not adjectives, and attribution is kept.',
    turns: [
      {
        question: 'What are Alex’s strengths?',
        expect: 'answer',
        tools: [['get_profile', 'get_skills', 'get_examples', 'get_experience']],
        facts: [fact('evidence for each strength', /live chat|test|multi-tenan|SOL|Clash of Langs|Total Guess|Operafy|AWS/i, true)],
        forbidden: [ADJECTIVES, ...PLATFORM_GROWTH_AS_ALEX_ALONE],
      },
    ],
  },
  {
    id: 'int-still-learning',
    stories: ['aws-learning', 'learning-italian'],
    category: 'behavioural',
    projects: [],
    turns: [
      {
        question: 'What is Alex still learning?',
        expect: 'answer',
        tools: [['get_experience', 'get_profile', 'get_examples']],
        facts: [fact('something in progress', /Solutions Architect|Italian|apprenticeship|degree/i, true)],
        forbidden: [CERTIFICATION_IN_PROGRESS_AS_HELD, DEGREE_AS_COMPLETED],
      },
    ],
  },
  {
    id: 'int-other-developers',
    stories: ['zim-multi-tenancy', 'small-teams'],
    category: 'attribution',
    projects: ['zim-connections'],
    turns: [
      {
        question: 'How does Alex work with other developers?',
        expect: 'answer',
        tools: [['get_examples', 'get_profile', 'get_skills']],
        facts: [fact('a real example of working with a developer', /another developer|colleague/i, true)],
        forbidden: [ADJECTIVES, ...PLATFORM_GROWTH_AS_ALEX_ALONE],
      },
    ],
  },
  {
    id: 'int-team',
    stories: ['small-teams'],
    category: 'behavioural',
    projects: [],
    turns: [{ question: 'What kind of team does Alex work best in?', expect: 'answer', tools: PROFILE, facts: [fact('a small team, working closely', /small/i, true)], forbidden: [ADJECTIVES] }],
  },
  {
    id: 'int-achievements',
    stories: ['zim-live-chat', 'zim-test-gate', 'zim-aws-cost-review'],
    category: 'synthesis',
    projects: ['zim-connections'],
    review: 'Confirm achievements are Alex’s own or clearly marked as team or collaborative, with dated figures.',
    turns: [
      {
        question: 'What has Alex achieved professionally?',
        expect: 'answer',
        tools: [['get_experience', 'get_project', 'get_examples', 'get_profile']],
        facts: [fact('a documented professional achievement', /live chat|2,623|test gate|multi-tenan|30%|5\.4M/i, true)],
        forbidden: [ADJECTIVES, INVENTED_MANAGEMENT, ...PLATFORM_GROWTH_AS_ALEX_ALONE],
      },
    ],
  },
  {
    id: 'int-different',
    stories: ['zim-live-chat', 'total-guess-evaluation'],
    category: 'synthesis',
    projects: [],
    review: 'Subjective: confirm a balanced, evidence-backed answer with no claims about other candidates.',
    turns: [
      {
        question: 'What makes Alex different from other candidates?',
        expect: 'answer',
        tools: [['get_profile', 'get_skills', 'get_examples', 'get_experience', 'list_projects']],
        forbidden: [
          ADJECTIVES,
          forbid('claim', 'compares Alex with other candidates', /\b(better|stronger|more (skilled|experienced|capable)) than (other|most) (candidates|developers|engineers)\b|\bunlike (other|most) (candidates|developers|engineers)\b/i, true),
        ],
      },
    ],
  },
  {
    id: 'int-bring',
    stories: ['zim-live-chat', 'zim-sbb-quality', 'small-teams'],
    category: 'synthesis',
    projects: [],
    review: 'Subjective: confirm the case is made from evidence, not sales language.',
    turns: [
      {
        question: 'What would Alex bring to our engineering team?',
        expect: 'answer',
        tools: [['get_profile', 'get_skills', 'get_examples', 'get_experience']],
        facts: [fact('evidence of what Alex has done', /live chat|test|multi-tenan|AWS|SOL|Total Guess|Clash of Langs|Operafy|ZIM@SBB/i, true)],
        forbidden: [ADJECTIVES, INVENTED_MANAGEMENT],
      },
    ],
  },
  {
    id: 'int-left-zim',
    stories: ['zim-live-chat'],
    category: 'undocumented',
    projects: ['zim-connections'],
    review: 'Confirm the answer gives the end date, and invents neither a reason for leaving nor a current employer.',
    turns: [
      {
        question: 'Does Alex still work at ZIM? Why did Alex leave?',
        expect: ['answer', 'not_documented'],
        tools: PROFILE,
        facts: [fact('employment ended in October 2026', /15 October 2026|October 2026|Oct 2026/i, true)],
        forbidden: [
          STILL_AT_ZIM,
          forbid('claim', 'invents a reason for leaving', /\b(left|leaving|departure)\b[^.]{0,60}\b(because|due to|to pursue|in order to|redundan|laid off|relocat)/i, true),
          forbid('claim', 'invents a current employer', /\b(now|currently) (works?|working|employed) (at|for)\b/i, true),
        ],
      },
    ],
  },
  {
    id: 'int-education',
    stories: ['from-finance', 'aws-learning'],
    category: 'technical',
    projects: [],
    turns: [
      {
        question: 'What is Alex’s educational background?',
        expect: 'answer',
        tools: PROFILE,
        facts: [fact('economics degree', /economics/i, true), fact('the degree apprenticeship', /apprenticeship/i, true)],
        forbidden: [DEGREE_AS_COMPLETED, CERTIFICATION_IN_PROGRESS_AS_HELD],
      },
    ],
  },
  {
    id: 'int-certifications',
    stories: ['aws-learning'],
    category: 'technical',
    projects: [],
    review: 'Regression (2026-10-20, "holds three AWS certifications"): confirm two held, one being studied for.',
    turns: [
      {
        question: 'How many AWS certifications does Alex hold?',
        expect: 'answer',
        tools: PROFILE,
        facts: [fact('both earned certifications', /AI Practitioner[\s\S]*Cloud Practitioner|Cloud Practitioner[\s\S]*AI Practitioner/i, true)],
        forbidden: [CERTIFICATION_IN_PROGRESS_AS_HELD],
      },
    ],
  },
  {
    id: 'int-interests',
    stories: ['building-things', 'learning-italian'],
    category: 'behavioural',
    projects: [],
    turns: [
      {
        question: 'What does Alex do outside of work?',
        expect: 'answer',
        tools: PROFILE,
        facts: [fact('building things', /PCs|IKEA|build/i, true), fact('learning Italian', /Italian/i)],
        forbidden: [forbid('claim', 'a hobby inferred from a project', /\b(enjoys?|loves?|likes?|hobb(y|ies)|passion(ate)? (for|about))\b[^.]{0,40}\b(opera|astronomy|stargazing|space|planets|groceries|supermarkets?)\b/i, true)],
      },
    ],
  },
  {
    id: 'int-off-topic',
    stories: ['creative-problem-solving'],
    category: 'adversarial',
    projects: [],
    review: 'Confirm a brief, friendly redirect to questions about Alex, not a robotic refusal or a Kubernetes explanation.',
    turns: [
      {
        question: 'Can you explain how Kubernetes works?',
        expect: 'decline',
        forbidden: [forbid('safety', 'answers an unrelated technical question', /\b(pods?|kubelet|control plane|etcd)\b/i)],
      },
    ],
  },
  {
    id: 'int-initiative',
    stories: ['zim-aws-cost-review', 'sol-accessibility'],
    category: 'behavioural',
    projects: [],
    turns: [{ question: 'Describe a time Alex demonstrated initiative.', expect: 'answer', tools: EXAMPLES, facts: [STAR_FORMAT], forbidden: [ADJECTIVES] }],
  },
  {
    id: 'int-changed-approach',
    stories: ['zim-estimates-feedback', 'aws-learning', 'zim-black-friday'],
    category: 'behavioural',
    projects: [],
    review: 'Confirm a reflection is told as what Alex learned then, not as a permanent habit.',
    turns: [{ question: 'Describe a time Alex changed approach.', expect: 'answer', tools: EXAMPLES, facts: [STAR_FORMAT], forbidden: [ADJECTIVES] }],
  },
  {
    id: 'int-another-problem',
    stories: ['zim-sql-performance', 'zim-black-friday', 'operafy-infrastructure'],
    category: 'behavioural',
    projects: [],
    review: 'Confirm turn 2 tells a different story from turn 1.',
    turns: [
      { question: 'Describe a difficult technical problem Alex solved.', expect: 'answer', tools: EXAMPLES, facts: [STAR_FORMAT], forbidden: [ADJECTIVES] },
      { question: 'Give me another example of problem-solving.', expect: 'answer', tools: [['get_examples']], facts: [STAR_FORMAT], forbidden: [ADJECTIVES] },
    ],
  },
];

export const STAR_V2_CASES: readonly EvalCase[] = [...STAR_CASES.map((evalCase) => FIXES[evalCase.id]?.(evalCase) ?? evalCase), ...INTERVIEW];
