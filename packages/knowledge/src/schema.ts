import { z } from 'zod';

/**
 * The knowledge model. Every claim about Alex's work is a piece of evidence:
 * it names the sources that support it and carries a verification status.
 * Only `verified` evidence survives the build into the public bundle.
 */

const Text = z.string().trim().min(1);

export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lower-kebab-case, e.g. "clash-of-langs"');

const HttpsUrl = z.url({ protocol: /^https$/, hostname: z.regexes.domain });

export const VerificationStatusSchema = z.enum(['verified', 'unverified']);

const evidence = {
  sources: z.array(SlugSchema).min(1, 'every claim needs at least one source'),
  status: VerificationStatusSchema.default('verified'),
};

export const SourceSchema = z.strictObject({
  id: SlugSchema,
  label: Text,
  kind: z.enum([
    'cv',
    'repository',
    'documentation',
    'profile',
    'store-listing',
    'website',
    'author-statement',
  ]),
  url: HttpsUrl.optional(),
});

export const FactSchema = z.strictObject({ text: Text, ...evidence });

export const TechnologySchema = z.strictObject({
  name: Text,
  category: z.enum(['language', 'frontend', 'mobile', 'backend', 'data', 'cloud', 'devops', 'ai', 'testing', 'platform']),
  ...evidence,
});

/** `individual`: Alex's own work. `collaborative`: Alex working with others. `team`: a team result Alex contributed to. */
export const ResponsibilitySchema = z.strictObject({
  text: Text,
  scope: z.enum(['individual', 'collaborative', 'team']),
  ...evidence,
});

export const ChallengeSchema = z.strictObject({
  title: Text,
  problem: Text,
  approach: z.array(Text).min(1),
  outcome: Text.optional(),
  ...evidence,
});

export const DecisionSchema = z.strictObject({
  title: Text,
  decision: Text,
  rationale: Text,
  alternatives: z.array(Text).default([]),
  tradeoffs: z.array(Text).default([]),
  ...evidence,
});

export const DiagramSchema = z.strictObject({
  title: Text,
  format: z.literal('mermaid'),
  source: Text,
  ...evidence,
});

export const LinkSchema = z.strictObject({
  label: Text,
  url: HttpsUrl,
  kind: z.enum(['live', 'source', 'store', 'documentation', 'website', 'profile']),
});

export const ProjectObject = z.strictObject({
  $schema: z.string().optional(),
  id: SlugSchema,
  name: Text,
  aliases: z.array(SlugSchema).default([]),
  order: z.int().positive(),
  focus: Text,
  tagline: Text,
  listingTags: z.array(Text).min(1).max(5),
  context: z.strictObject({
    kind: z.enum(['employment', 'personal', 'client']),
    organisation: Text.optional(),
    role: Text.optional(),
    period: Text.optional(),
  }),
  /** `public`: open source or publicly documented. `professional`: employer work, no source access. `private`: never published. */
  visibility: z.enum(['public', 'professional', 'private']),
  topics: z.array(Text).default([]),
  sources: z.array(SourceSchema).min(1),
  overview: z.array(FactSchema).default([]),
  technologies: z.array(TechnologySchema).default([]),
  responsibilities: z.array(ResponsibilitySchema).default([]),
  architecture: z
    .strictObject({
      overview: z.array(FactSchema).default([]),
      diagrams: z.array(DiagramSchema).default([]),
    })
    .default({ overview: [], diagrams: [] }),
  challenges: z.array(ChallengeSchema).default([]),
  decisions: z.array(DecisionSchema).default([]),
  lessons: z.array(FactSchema).default([]),
  limitations: z.array(FactSchema).default([]),
  links: z.array(LinkSchema).default([]),
  /** Topics known to be missing, so answers can say so instead of guessing. */
  undocumented: z.array(Text).default([]),
});

export const ProjectSchema = ProjectObject.superRefine(checkSourceReferences);

export const ProfileObject = z.strictObject({
  $schema: z.string().optional(),
  name: Text,
  title: Text,
  location: Text,
  bannerSkills: z.array(Text).min(1).max(6),
  sources: z.array(SourceSchema).min(1),
  summary: z.array(FactSchema).min(1),
  contact: z.strictObject({
    email: z.email(),
    links: z.array(LinkSchema).default([]),
  }),
  experience: z
    .array(
      z.strictObject({
        organisation: Text,
        role: Text,
        period: Text,
        location: Text.optional(),
        projects: z.array(SlugSchema).default([]),
        ...evidence,
      }),
    )
    .default([]),
  education: z
    .array(
      z.strictObject({
        qualification: Text,
        institution: Text,
        period: Text.optional(),
        detail: Text.optional(),
        ...evidence,
      }),
    )
    .default([]),
  certifications: z
    .array(
      z.strictObject({
        name: Text,
        issuer: Text,
        progress: z.enum(['earned', 'in-progress']),
        date: Text.optional(),
        ...evidence,
      }),
    )
    .default([]),
  languages: z
    .array(z.strictObject({ language: Text, level: Text, ...evidence }))
    .default([]),
  /** How Alex works: an ordered delivery loop, and where AI sits in it. */
  workingApproach: z
    .strictObject({
      summary: Text,
      steps: z.array(z.strictObject({ title: Text, description: Text, ...evidence })).min(1),
      ai: z.array(FactSchema).default([]),
    })
    .optional(),
});

export const ProfileSchema = ProfileObject.superRefine(checkSourceReferences);

export const SkillSchema = z.strictObject({
  id: SlugSchema,
  name: Text,
  category: z.enum(['language', 'frontend', 'mobile', 'backend', 'data', 'cloud', 'devops', 'ai', 'quality', 'practice']),
  /** Featured projects that demonstrate the skill. May be empty when the only evidence is the CV. */
  projects: z.array(SlugSchema).default([]),
  ...evidence,
});

export const SkillsSchema = z
  .strictObject({
    $schema: z.string().optional(),
    sources: z.array(SourceSchema).min(1),
    skills: z.array(SkillSchema).min(1),
  })
  .superRefine(checkSourceReferences);

export const KNOWLEDGE_BUNDLE_VERSION = 1;

export const KnowledgeBundleSchema = z.strictObject({
  version: z.literal(KNOWLEDGE_BUNDLE_VERSION),
  profile: ProfileSchema,
  skills: SkillsSchema,
  projects: z.array(ProjectSchema),
});

export type Source = z.infer<typeof SourceSchema>;
export type Fact = z.infer<typeof FactSchema>;
export type Technology = z.infer<typeof TechnologySchema>;
export type Responsibility = z.infer<typeof ResponsibilitySchema>;
export type TechnicalChallenge = z.infer<typeof ChallengeSchema>;
export type ArchitectureDecision = z.infer<typeof DecisionSchema>;
export type Diagram = z.infer<typeof DiagramSchema>;
export type ProjectLink = z.infer<typeof LinkSchema>;
export type PortfolioProject = z.infer<typeof ProjectSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type Skills = z.infer<typeof SkillsSchema>;
export type KnowledgeBundle = z.infer<typeof KnowledgeBundleSchema>;

/** Every `sources` id used anywhere in a document must be declared in that document's `sources` list. */
function checkSourceReferences(document: { sources: Source[] }, ctx: z.RefinementCtx): void {
  const declared = new Set<string>();
  document.sources.forEach((source, index) => {
    if (declared.has(source.id)) {
      ctx.addIssue({ code: 'custom', path: ['sources', index, 'id'], message: `duplicate source id "${source.id}"` });
    }
    declared.add(source.id);
  });

  const visit = (value: unknown, path: PropertyKey[]): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, index]));
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'sources' && path.length > 0 && Array.isArray(child)) {
        child.forEach((id, index) => {
          if (typeof id === 'string' && !declared.has(id)) {
            ctx.addIssue({ code: 'custom', path: [...path, key, index], message: `unknown source "${id}"` });
          }
        });
      } else {
        visit(child, [...path, key]);
      }
    }
  };
  visit(document, []);
}
