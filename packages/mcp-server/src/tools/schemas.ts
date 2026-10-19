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
};

export const GetProfileOutput = {
  ...ProfileObject.pick({ name: true, title: true, location: true, summary: true, contact: true, languages: true, workingApproach: true }).shape,
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
  certifications: ProfileObject.shape.certifications,
  citations: Citations.describe('The profile sources cited by employment, education and certifications'),
};

export const GetSkillsOutput = {
  skills: z.array(
    SkillSchema.omit({ projects: true }).extend({
      projects: z.array(z.object({ id: z.string(), name: z.string(), uri: Uri })),
    }),
  ),
  citations: Citations,
};
