import {
  PROJECT_DATA_SECTIONS,
  ProfileObject,
  ProjectObject,
  ResponsibilitySchema,
  SkillSchema,
  SourceSchema,
} from '@portfolio/knowledge';
import { z } from 'zod';

/*
 * Output schemas, built from the knowledge schemas so a tool's contract can't
 * drift from the data it returns. Each `sources` array holds source ids, and
 * each `citations` array resolves those ids to labels and URLs.
 */

const Citations = z.array(SourceSchema).describe('The sources cited by `sources` ids in this result');
const Uri = z.string().describe('MCP resource URI of the full Markdown document');

export const ProjectHeader = ProjectObject.pick({
  id: true,
  comingSoon: true,
  name: true,
  aliases: true,
  focus: true,
  tagline: true,
  listingTags: true,
  context: true,
  visibility: true,
  topics: true,
});

const ProjectSections = ProjectObject.pick(
  Object.fromEntries(PROJECT_DATA_SECTIONS.map((section) => [section, true])) as Record<(typeof PROJECT_DATA_SECTIONS)[number], true>,
).partial();

export const SectionName = z.enum(PROJECT_DATA_SECTIONS);

export const ListProjectsOutput = {
  projects: z.array(ProjectHeader.extend({ uri: Uri })),
};

export const GetProjectOutput = {
  project: ProjectHeader.extend(ProjectSections.shape),
  sections: z.array(SectionName).describe('The sections included in `project`'),
  omittedSections: z.array(SectionName).describe('Sections this project has content in that were not requested, so are not included'),
  complete: z.boolean().describe('True when every section with content is included and the project has no examples elsewhere; false otherwise'),
  note: z.string().optional().describe('Present when the record is not everything documented about the project: what to check before saying it does not document something'),
  relatedFromOmitted: z
    .array(z.object({ section: z.string(), text: z.string(), sources: z.array(z.string()) }))
    .optional()
    .describe('With `relatedTo` on a partial record: passages from the omitted sections that match it'),
  examples: z
    .array(z.object({ id: z.string(), title: z.string() }))
    .optional()
    .describe('Examples about this project, told in full by get_examples'),
  relatedFromExamples: z
    .array(z.object({ example: z.string(), part: z.string(), text: z.string(), basis: z.string(), sources: z.array(z.string()) }))
    .optional()
    .describe("With `relatedTo`: passages from this project's examples that match it"),
  uri: Uri,
  citations: Citations,
};

export const SearchProjectsOutput = {
  query: z.string(),
  results: z.array(
    z.object({
      projectId: z.string(),
      projectName: z.string(),
      score: z.number().describe('Relative relevance; only meaningful within one result set'),
      uri: Uri,
      matches: z.array(z.object({ field: z.string(), text: z.string(), sources: z.array(z.string()) })),
      citations: Citations,
    }),
  ),
  examples: z
    .array(z.object({ id: z.string(), title: z.string(), projects: z.array(z.string()) }))
    .optional()
    .describe('Examples (from get_examples) whose text matches the query'),
};

const PersonalItem = z.object({
  title: z.string(),
  text: z.string(),
  projects: z.array(z.object({ id: z.string(), name: z.string(), uri: Uri })),
});

export const GetProfileOutput = {
  ...ProfileObject.pick({ name: true, title: true, location: true, summary: true, contact: true, languages: true, workingApproach: true }).shape,
  interests: z.object({ personal: z.array(PersonalItem), technical: z.array(PersonalItem) }).describe('Published interests; empty until Alex approves them'),
  background: z.object({ motivation: z.array(PersonalItem), workingEnvironment: z.array(PersonalItem) }).describe('Why Alex works in software and career goals (motivation); how Alex works best, strengths, frustrations and the first six months in a new role (workingEnvironment)'),
  citations: Citations,
};

const StoryPartOutput = z.object({
  text: z.string(),
  basis: z.string().describe('"project records" (documented) or "Alex\'s own account" (firsthand)'),
  sources: z.array(z.string()),
});

export const GetExamplesOutput = {
  examples: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      organisation: z.string().optional(),
      projects: z.array(z.object({ id: z.string(), name: z.string(), uri: Uri })),
      competencies: z.array(z.object({ id: z.string(), name: z.string() })),
      situation: StoryPartOutput,
      task: StoryPartOutput,
      action: StoryPartOutput,
      result: StoryPartOutput,
      reflection: StoryPartOutput.optional(),
      attribution: z.enum(['individual', 'collaborative', 'team']),
      attributionNote: z.string().describe('Who did what, in plain words'),
    }),
  ),
  matched: z.number().int().describe('How many published examples fit the request'),
  returned: z.number().int(),
  complete: z.boolean().describe('True when every matching example is returned'),
  competency: z
    .object({ id: z.string(), name: z.string(), examples: z.number().int().describe('How many published examples this competency has') })
    .optional()
    .describe('The competency the request was about, given or recognised in `query`'),
  gap: z.string().optional().describe("For a competency: evidence that isn't documented"),
  citations: Citations,
};

export const GetExperienceOutput = {
  employment: z.array(
    z.object({
      organisation: z.string(),
      role: z.string(),
      period: z.string(),
      location: z.string().optional(),
      sources: z.array(z.string()),
      projects: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          uri: Uri,
          responsibilities: z.array(ResponsibilitySchema),
          citations: Citations.describe('The project sources cited by `responsibilities`'),
        }),
      ),
    }),
  ),
  education: ProfileObject.shape.education,
  certifications: z
    .object({
      earned: ProfileObject.shape.certifications.describe('Certifications Alex holds'),
      earnedCount: z.number().int().describe('How many certifications Alex holds: count only these'),
      inProgress: ProfileObject.shape.certifications.describe('Certifications Alex is studying for: not held, never count them as earned'),
    })
    .describe('Earned certifications and those in progress, kept apart'),
  citations: Citations.describe('The profile sources cited by employment, education and certifications'),
};

export const GetSkillsOutput = {
  skills: z.array(
    SkillSchema.omit({ projects: true }).extend({
      projects: z.array(z.object({ id: z.string(), name: z.string(), uri: Uri })),
    }),
  ),
  softSkills: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        group: z.enum(['core', 'mindset']),
        description: z.string(),
        examples: z.array(z.object({ id: z.string(), title: z.string() })).describe('Strongest first; tell them with get_examples'),
        gap: z.string().optional(),
      }),
    )
    .describe('Soft skills and ways of working, each with published examples'),
  citations: Citations,
};
