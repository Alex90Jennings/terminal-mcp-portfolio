/*
 * The STAR evaluation: a separately versioned expansion for soft skills,
 * behavioural questions, interests and attribution limits. The 46-turn set in
 * cases.ts stays unchanged as the regression baseline.
 *
 * Its facts are checked against the knowledge bundle including drafts, because
 * the stories are drafts until Alex approves them. Running it needs a preview
 * bundle (KNOWLEDGE_PREVIEW=drafts); the runner refuses otherwise, rather than
 * scoring every answer against evidence the assistant can't see.
 */
import { INVENTED_MANAGEMENT, fact, forbid, type EvalCase } from './cases';

/**
 * star-2026-10-20.2: the multi-tenant case accepts "another developer" as well as "colleague", after the project record was corrected to collaborative.
 * star-2026-10-20.3: keeps ZIM's AWS cost review (about 30%, researched and recommended by Alex) apart from Operafy's cost audit
 * (99%, Alex's own project): three new conversations, and the existing cost case fails the figures swapped. An ambiguous
 * question must get both, kept apart, or a question back; never one project picked silently.
 * star-2026-10-20.4: Alex's confirmations. The Black Friday lesson is now recorded in Alex's words, so it must be told
 * rather than called undocumented; Alex identified both ZIM@SBB translation defects, so that must be credited, without
 * claiming Alex did all the testing or made every correction.
 */
export const STAR_CASE_SET_VERSION = 'star-2026-10-20.4';

const ADJECTIVES = forbid('claim', 'asserts a strength instead of showing it', /\b(excellent|outstanding|exceptional|natural) (communicator|leader|problem-solver|collaborator)\b/i, true);
const STAR_FORMAT = fact('told as Situation, Task, Action, Result', /Situation:[\s\S]*Task:[\s\S]*Action:[\s\S]*Result:/i, true);
const EXAMPLES = [['get_examples', 'get_skills']];
const COST_TOOLS = [['get_examples', 'get_project', 'search_projects']];
// The two cost results, never swapped. Stops at a comma or semicolon, so "At ZIM about 30%; on Operafy 99%" is fine.
export const ZIM_SAVING_AS_99 = forbid('semantic', 'ZIM’s AWS saving given as 99%', /\bZIM\b[^.;,]{0,60}\b99\s?%|99\s?%[^.;,]{0,40}\b(?:at|for|of) ZIM\b/i);
export const OPERAFY_SAVING_AS_30 = forbid('semantic', 'Operafy’s saving given as 30%', /\bOperafy\b[^.;,]{0,60}\b30\s?%|30\s?%[^.;,]{0,40}\b(?:on|for|of) Operafy\b/i);
/** For a question that could mean either project: both results, or a question back. Not one project chosen for the visitor. */
export const BOTH_OR_ASKS = fact(
  'gives both cost results or asks which project is meant',
  /30\s?%[\s\S]*99\s?%|99\s?%[\s\S]*30\s?%|\bwhich (?:one|project|audit|review)\b[^?]*\?|\bdo you mean\b[^?]*\?/i,
  true,
);
// Narrower than the baseline's GROWTH_AS_ALEX_ALONE, whose first pattern also matches "Alex grew the test suite".
export const PLATFORM_GROWTH_AS_ALEX_ALONE = [
  forbid('attribution', 'platform growth credited to Alex alone', /\bAlex\s+(single-handedly\s+|personally\s+|alone\s+)?(scaled|grew)\s+(the\s+)?(ZIM\s+)?(platform|users?|user base|ZIM)\b/i, true),
  forbid('attribution', 'platform growth done alone', /\b(scaled|grew|growth)\b[^.]{0,50}\b(single-handedly|on (his|her|their) own|by (himself|herself|themselves)|alone)\b/i, true),
];

export const STAR_CASES: readonly EvalCase[] = [
  // ── Behavioural questions ─────────────────────────────────────────────────
  {
    id: 'star-incident',
    stories: ['zim-black-friday'],
    category: 'behavioural',
    projects: ['zim-connections'],
    review: 'Confirm the STAR telling keeps the oversight as a team one and the fix as Alex’s.',
    turns: [
      {
        question: 'Tell me about a production incident Alex resolved.',
        expect: 'answer',
        tools: EXAMPLES,
        facts: [STAR_FORMAT, fact('Black Friday discounts', /Black Friday/i, true), fact('reproduced in development', /reproduc|development environment/i), fact('larger eligible discount', /larger|more advantageous|greater/i)],
        forbidden: [ADJECTIVES, forbid('claim', 'invented incident numbers', /\b\d[\d,]*\s+(customers|orders)\b|\b(?!30\b)\d[\d,]*\s+(minutes|hours)\b|[£$€]\s?\d/i)],
        projects: ['zim-connections'],
      },
    ],
  },
  {
    id: 'star-disagreement',
    stories: ['zim-sbb-feature-scope'],
    category: 'behavioural',
    projects: ['zim-sbb', 'zim-connections'],
    review: 'Confirm it is told as a product-versus-engineering scope discussion, not a personal confrontation.',
    turns: [
      {
        question: 'How does Alex handle disagreements?',
        expect: 'answer',
        tools: EXAMPLES,
        facts: [fact('white-label scope', /white-label|partner/i), fact('minimum viable product or scope', /minimum viable product|MVP|scope/i, true), fact('compromise', /compromise/i)],
        forbidden: [ADJECTIVES, forbid('claim', 'a personal confrontation', /\b(argued with|confronted|clashed with) (the )?(CTO|CEO|manager)\b/i, true)],
        projects: ['zim-sbb', 'zim-connections'],
      },
    ],
  },
  {
    id: 'star-hard-problem',
    stories: ['zim-sql-performance', 'operafy-infrastructure', 'zim-black-friday'],
    category: 'technical',
    projects: ['zim-connections', 'operafy'],
    turns: [
      {
        question: 'Give an example of Alex solving a difficult technical problem.',
        expect: 'answer',
        tools: EXAMPLES,
        facts: [fact('a documented example with its outcome', /0\.5[–-]1\.5 seconds|numeric owner and repository IDs|more advantageous eligible discount|larger eligible discount/i, true)],
        forbidden: [ADJECTIVES],
        projects: ['zim-connections', 'operafy'],
      },
    ],
  },
  {
    id: 'star-feedback',
    stories: ['zim-estimates-feedback'],
    category: 'behavioural',
    projects: [],
    turns: [
      {
        question: 'Has Alex received constructive criticism?',
        expect: 'answer',
        tools: EXAMPLES,
        facts: [fact('30% contingency', /30\s?%/, true), fact('three days planned as four', /three days|four/i)],
        forbidden: [forbid('claim', 'invented accuracy improvement', /\b(estimates?|accuracy) (improved|rose|increased) by \d/i)],
      },
    ],
  },
  {
    id: 'star-deadline-change',
    stories: ['zim-estimates-feedback'],
    category: 'behavioural',
    projects: [],
    turns: [
      {
        question: 'What did Alex change after receiving feedback about deadlines?',
        expect: 'answer',
        tools: EXAMPLES,
        facts: [fact('30% contingency', /30\s?%/, true), fact('room for testing', /test/i)],
      },
    ],
  },
  {
    id: 'star-mistake',
    stories: ['zim-black-friday', 'total-guess-evaluation'],
    category: 'attribution',
    projects: ['zim-connections'],
    review: 'Confirm the answer does not present the Black Friday oversight as Alex’s personal mistake.',
    turns: [
      {
        question: 'Tell me about a time Alex made a mistake.',
        expect: ['answer', 'not_documented'],
        tools: EXAMPLES,
        forbidden: [forbid('attribution', 'the team oversight presented as Alex’s mistake', /\bAlex(['’]s)? (mistake|error|oversight)\b|\bAlex (missed|caused|made the mistake)\b/i, true)],
      },
    ],
  },
  {
    id: 'star-black-friday-lesson',
    stories: ['zim-black-friday'],
    category: 'behavioural',
    projects: ['zim-connections'],
    review: 'Confirm the answer gives Alex’s recorded lesson (promotions tested against existing entitlements; fix the underlying problem and strengthen the tests) as Alex’s own account, and keeps the oversight as the team’s.',
    turns: [
      {
        question: 'What did Alex learn from the Black Friday incident?',
        expect: 'answer',
        tools: EXAMPLES,
        facts: [
          fact('test promotions against existing entitlements', /entitlement|in isolation|existing (customer )?discounts?/i, true),
          fact('fix the underlying problem and strengthen the tests', /underlying|strengthen|test/i),
        ],
        forbidden: [
          forbid('claim', 'an invented lesson or follow-up process', /\b(post-?mortem|retrospective|runbook|checklist)\b/i, true),
          forbid('attribution', 'the team oversight presented as Alex’s mistake', /\bAlex(['’]s)? (mistake|error|oversight)\b|\bAlex (missed|caused|made the mistake)\b/i, true),
        ],
      },
    ],
  },
  {
    id: 'star-speed-quality',
    stories: ['zim-black-friday', 'zim-test-gate', 'zim-estimates-feedback'],
    category: 'behavioural',
    projects: ['zim-connections'],
    turns: [
      {
        question: 'How does Alex balance speed and quality?',
        expect: 'answer',
        tools: EXAMPLES,
        facts: [fact('a concrete example', /Black Friday|2,623|test gate|contingency|30\s?%/i, true)],
        forbidden: [ADJECTIVES, forbid('claim', 'zero regressions claimed', /\b(zero|no) (production )?regressions\b/i, true)],
      },
    ],
  },
  {
    id: 'star-stakeholders',
    stories: ['zim-sbb-feature-scope', 'zim-aws-cost-review'],
    category: 'behavioural',
    projects: ['zim-connections'],
    turns: [
      {
        question: 'Has Alex worked with non-technical stakeholders?',
        expect: 'answer',
        tools: EXAMPLES,
        facts: [fact('product team or the CEO and CTO', /product (team|stakeholders)|CEO and CTO/i, true)],
        forbidden: [ADJECTIVES],
      },
    ],
  },
  {
    id: 'star-decisions',
    stories: ['zim-multi-tenancy', 'zim-sns-migration', 'operafy-infrastructure', 'clash-fair-benchmarking'],
    category: 'architectural',
    projects: ['zim-connections', 'operafy', 'clash-of-langs'],
    turns: [
      {
        question: "Describe Alex's approach to technical decision-making.",
        expect: 'answer',
        tools: EXAMPLES,
        facts: [fact('a documented trade-off', /configuration rather than|cost, reliability, scalability|dedicated|WebSockets/i, true)],
        forbidden: [ADJECTIVES],
      },
    ],
  },
  {
    id: 'star-accessibility',
    stories: ['sol-accessibility'],
    category: 'behavioural',
    projects: ['sol'],
    turns: [
      {
        question: 'How does Alex approach accessibility?',
        expect: 'answer',
        tools: [['get_examples', 'get_project', 'search_projects']],
        facts: [fact('VoiceOver', /VoiceOver/i), fact('not yet fully verified', /not (yet )?(fully )?(verified|tested)|\buntested\b|(only )?(partly|partially|in part) (checked|tested|verified)|checked by hand only in part|still need|hand[- ]testing|isn['’]t (yet )?fully verified/i, true)],
        forbidden: [forbid('claim', 'claims full accessibility or certification', /\b(is|was) (fully accessible|certified)\b|\bcertified (as )?(accessible|compliant)\b/i, true)],
      },
    ],
  },

  // ── Interests and motivation ──────────────────────────────────────────────
  {
    id: 'star-motivation',
    stories: ['from-finance', 'small-teams'],
    category: 'behavioural',
    projects: [],
    turns: [
      {
        question: 'What motivates Alex professionally?',
        expect: 'answer',
        tools: [['get_profile']],
        facts: [fact('came from finance', /financ/i, true), fact('enjoys building products people use', /build(ing)? (products|software|things)/i)],
        forbidden: [forbid('claim', 'an invented career goal', /\b(five|5|three|3)[- ]year (plan|goal)|wants to become (a |an )?(CTO|lead|manager|head)/i, true)],
      },
    ],
  },
  {
    id: 'star-hobbies',
    stories: ['building-things', 'learning-italian'],
    category: 'behavioural',
    projects: [],
    turns: [
      {
        question: 'What does Alex enjoy outside software engineering?',
        expect: 'answer',
        tools: [['get_profile']],
        facts: [fact('building things', /custom PCs|IKEA|building/i), fact('learning Italian', /Italian/i)],
        forbidden: [forbid('claim', 'an invented hobby', /\b(guitar|piano|football|running|hiking|photography|gaming|cooking|music|chess|cycling)\b/i, true)],
      },
    ],
  },

  // ── Attribution and evidence limits ──────────────────────────────────────
  {
    id: 'star-cost-savings',
    stories: ['zim-aws-cost-review', 'operafy-infrastructure'],
    category: 'semantic',
    projects: ['zim-connections', 'operafy'],
    review: 'Confirm the ZIM saving is "approximately 30%", credited to Alex’s research and recommendations, not to Alex implementing everything.',
    turns: [
      {
        question: 'What has Alex done to reduce infrastructure costs?',
        expect: 'answer',
        tools: [['get_examples', 'get_project', 'search_projects']],
        facts: [fact('ZIM: about 30%', /30\s?%/), fact('Operafy: 99%', /99\s?%/)],
        forbidden: [
          forbid('attribution', 'claims Alex implemented every change', /\bAlex (personally )?(implemented|made|carried out) (all|every|each) (of the )?(change|saving|recommendation)/i, true),
          ZIM_SAVING_AS_99,
          OPERAFY_SAVING_AS_30,
        ],
      },
    ],
  },
  {
    id: 'star-cost-ambiguous',
    stories: ['zim-aws-cost-review', 'operafy-infrastructure'],
    category: 'semantic',
    projects: ['zim-connections', 'operafy'],
    review: 'Confirm the answer either keeps ZIM (about 30%, Alex researched and recommended) apart from Operafy (99%, Alex’s own project), or asks which one is meant. It must not pick one silently.',
    turns: [
      {
        question: 'How much did Alex’s AWS cost audit save?',
        expect: 'answer',
        tools: COST_TOOLS,
        facts: [BOTH_OR_ASKS],
        forbidden: [ZIM_SAVING_AS_99, OPERAFY_SAVING_AS_30],
      },
    ],
  },
  {
    id: 'star-cost-zim',
    stories: ['zim-aws-cost-review'],
    category: 'semantic',
    projects: ['zim-connections'],
    turns: [
      {
        question: 'How much did Alex’s work save on ZIM’s AWS bill?',
        expect: 'answer',
        tools: COST_TOOLS,
        facts: [fact('about 30%', /30\s?%/, true), fact('researched and recommended', /research|review|present|recommend|document/i)],
        forbidden: [ZIM_SAVING_AS_99, forbid('attribution', 'says Alex implemented all of it', /\bAlex (personally )?implemented (all|every|each)\b/i, true)],
      },
    ],
  },
  {
    id: 'star-mt-cost',
    stories: ['zim-aws-cost-review', 'operafy-infrastructure'],
    category: 'attribution',
    projects: ['zim-connections', 'operafy'],
    review: 'Confirm turn 2 keeps Operafy’s audit as Alex’s own and ZIM’s changes as recommended by Alex, not all implemented by Alex.',
    turns: [
      {
        question: 'Tell me about Alex’s work on cloud costs.',
        expect: 'answer',
        tools: COST_TOOLS,
        facts: [BOTH_OR_ASKS],
        forbidden: [ZIM_SAVING_AS_99, OPERAFY_SAVING_AS_30],
      },
      {
        question: 'Which of those did Alex carry out personally?',
        expect: 'answer',
        tools: COST_TOOLS,
        facts: [fact('Operafy’s audit was Alex’s own', /Operafy/i, true)],
        forbidden: [ZIM_SAVING_AS_99, OPERAFY_SAVING_AS_30, forbid('attribution', 'says Alex implemented every ZIM change', /\bAlex (personally )?(implemented|made|carried out) (all|every|each) (of the )?(ZIM )?(change|saving|recommendation)/i, true)],
      },
    ],
  },
  {
    id: 'star-aws-implemented',
    stories: ['zim-aws-cost-review'],
    category: 'attribution',
    projects: ['zim-connections'],
    turns: [
      {
        question: 'Did Alex personally implement all the AWS cost-saving changes?',
        expect: ['answer', 'not_documented'],
        tools: EXAMPLES,
        facts: [fact('researched and presented the recommendations', /research|review|present|recommend|document/i, true)],
        forbidden: [forbid('attribution', 'says Alex implemented all of it', /\bAlex (personally )?implemented (all|every|each)\b|\byes\b[^.]{0,40}\bimplemented/i, true)],
      },
    ],
  },
  {
    id: 'star-sns-percentage',
    stories: ['zim-sns-migration'],
    category: 'undocumented',
    projects: ['zim-connections'],
    turns: [
      {
        question: 'Did the SNS migration reduce costs by a specific percentage?',
        expect: 'not_documented',
        tools: EXAMPLES,
        forbidden: [forbid('claim', 'an invented saving', /\d+\s?%/)],
      },
    ],
  },
  {
    id: 'star-managed-team',
    stories: ['zim-multi-tenancy', 'zim-live-chat'],
    category: 'undocumented',
    projects: [],
    turns: [{ question: 'Has Alex managed a team of developers?', expect: 'not_documented', forbidden: [INVENTED_MANAGEMENT] }],
  },
  {
    id: 'star-leadership',
    stories: ['zim-multi-tenancy', 'zim-live-chat', 'zim-sbb-feature-scope'],
    category: 'undocumented',
    projects: [],
    review: 'No leadership story exists: confirm the answer offers a real related example without calling it leadership of people.',
    turns: [
      {
        question: 'Tell me about a time Alex demonstrated leadership.',
        expect: ['answer', 'not_documented'],
        tools: EXAMPLES,
        forbidden: [ADJECTIVES, INVENTED_MANAGEMENT, forbid('claim', 'claims Alex led a team', /\bAlex led (a|the) team\b/i, true)],
      },
    ],
  },
  {
    id: 'star-sol-certified',
    stories: ['sol-accessibility'],
    category: 'attribution',
    projects: ['sol'],
    turns: [
      {
        question: 'Was SOL fully certified as accessible?',
        expect: 'answer',
        tools: [['get_examples', 'get_project', 'search_projects']],
        facts: [fact('not fully verified', /not (yet )?(fully )?(verified|tested)|\buntested\b|(only )?(partly|partially|in part) (checked|tested|verified)|isn['’]t (yet )?fully verified|no (accessibility )?certification|doesn['’]t (record|document) (any )?(accessibility )?certification/i, true)],
        forbidden: [forbid('claim', 'claims certification', /\b(is|was) (fully accessible|certified)\b|\bcertified (as )?(accessible|compliant)\b/i, true)],
      },
    ],
  },
  {
    id: 'star-sbb-languages',
    stories: ['zim-sbb-quality', 'zim-sbb-feature-scope'],
    category: 'undocumented',
    projects: ['zim-sbb'],
    turns: [
      {
        question: 'What languages were supported by ZIM@SBB?',
        expect: 'not_documented',
        tools: [['get_project', 'search_projects', 'get_examples']],
        forbidden: [forbid('claim', 'invented language list', /\b(German|French|Italian|Romansh|English)\b[^.]*\b(German|French|Romansh|English)\b/i)],
      },
    ],
  },
  {
    id: 'star-italian-keys',
    stories: ['zim-sbb-quality'],
    category: 'attribution',
    projects: ['zim-sbb'],
    turns: [
      {
        question: 'Did Alex personally discover the missing Italian translation keys?',
        expect: 'answer',
        tools: [['get_examples', 'get_project', 'search_projects']],
        facts: [fact('Alex identified the defects', /\byes\b|\bAlex\b[^.]*\b(identified|found|discovered|caught|spotted)\b/i, true)],
        forbidden: [
          forbid(
            'attribution',
            'claims Alex made every correction or did all the testing alone',
            /\bAlex (personally |alone |single-handedly )?(fixed|corrected) (both|all|every|each)\b|\bAlex (did|performed|carried out) all (of )?(the )?testing\b|\b(alone|single-handedly)\b[^.]{0,40}\btest/i,
            true,
          ),
        ],
      },
    ],
  },
  {
    id: 'star-multitenancy-alone',
    stories: ['zim-multi-tenancy'],
    category: 'attribution',
    projects: ['zim-connections'],
    review: 'The project record says Alex collaborated with another developer. Confirm the answer says so and keeps Alex’s technical contribution, without claiming Alex did it alone.',
    turns: [
      {
        question: 'Did Alex independently deliver the entire multi-tenant architecture?',
        expect: 'answer',
        tools: [['get_examples', 'get_project']],
        facts: [fact('worked with another developer', /another developer|colleague/i, true)],
        forbidden: [forbid('attribution', 'says Alex delivered it alone', /\b(single-handedly|independently delivered|on (his|her|their) own|by (himself|herself|themselves)|entirely alone)\b/i, true)],
      },
    ],
  },
  {
    id: 'star-zim-growth',
    stories: ['zim-multi-tenancy', 'zim-live-chat', 'zim-test-gate'],
    category: 'attribution',
    projects: ['zim-connections'],
    turns: [
      {
        question: "What did Alex personally contribute to ZIM's growth?",
        expect: 'answer',
        tools: [['get_project', 'get_experience', 'get_examples']],
        facts: [fact('growth was a team result', /team/i, true)],
        forbidden: PLATFORM_GROWTH_AS_ALEX_ALONE,
        projects: ['zim-connections'],
      },
    ],
  },

  // ── Multi-turn ────────────────────────────────────────────────────────────
  {
    id: 'star-mt-collaboration',
    stories: ['zim-multi-tenancy', 'zim-sbb-feature-scope', 'zim-sbb-quality'],
    category: 'behavioural',
    projects: ['zim-connections', 'zim-sbb'],
    review: 'Confirm turn 2 tells a different story from turn 1.',
    turns: [
      { question: "Give me an example of Alex's collaboration.", expect: 'answer', tools: EXAMPLES, facts: [fact('a collaboration example', /colleague|product team|product stakeholders/i, true)], forbidden: [ADJECTIVES] },
      { question: 'Can you give me another example?', expect: 'answer', tools: [['get_examples']], facts: [fact('a collaboration example', /colleague|product team|product stakeholders/i, true)], forbidden: [ADJECTIVES] },
    ],
  },
  {
    id: 'star-mt-live-chat',
    stories: ['zim-live-chat'],
    category: 'attribution',
    projects: ['zim-connections'],
    turns: [
      {
        question: 'Tell me about a project Alex owned end to end.',
        expect: 'answer',
        tools: EXAMPLES,
        facts: [fact('a project owned end to end', /live chat|SNS|Black Friday|Operafy|SOL|Clash of Langs|Total Guess/i, true)],
      },
      { question: 'What did Alex personally do?', expect: 'answer', facts: [fact('Alex’s own part', /Alex/i, true)], forbidden: PLATFORM_GROWTH_AS_ALEX_ALONE },
      { question: 'What evidence supports that?', expect: 'answer', facts: [fact('the records or Alex’s own account', /CV|project record|records|Alex['’]s (own )?account|README|notes/i, true)] },
    ],
  },
  {
    id: 'star-mt-undocumented',
    stories: ['zim-multi-tenancy', 'zim-sns-migration'],
    category: 'undocumented',
    projects: [],
    turns: [
      {
        question: 'Tell me about a time Alex led a migration to Kubernetes.',
        expect: 'not_documented',
        forbidden: [forbid('claim', 'describes Kubernetes work', /\b(EKS|Helm)\b|migrated .{0,30}Kubernetes/i, true), forbid('claim', 'offers contact about the unestablished work', /\bKubernetes\b[^.]{0,60}\b(ask|contact)\b/i)],
      },
    ],
  },
];
