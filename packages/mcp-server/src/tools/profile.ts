import { citationsFor, experienceOf, SkillSchema } from '@portfolio/knowledge';
import { projectUri } from '../uris.ts';
import { GetExperienceOutput, GetProfileOutput, GetSkillsOutput } from './schemas.ts';
import { guarded, READ_ONLY, success, type ToolModule } from './shared.ts';

export const getProfile: ToolModule = {
  name: 'get_profile',
  register(server, context) {
    server.registerTool(
      'get_profile',
      {
        title: 'Get profile',
        description:
          "A concise professional profile of Alex Jennings: summary, location, contact links, languages, and how Alex works, including where AI fits in. " +
          'For employment, education and certifications use get_experience.',
        inputSchema: {},
        outputSchema: GetProfileOutput,
        annotations: READ_ONLY,
      },
      guarded('get_profile', context, () => {
        const { profile } = context.kb;
        const content = {
          name: profile.name,
          title: profile.title,
          location: profile.location,
          summary: profile.summary,
          contact: profile.contact,
          languages: profile.languages,
          ...(profile.workingApproach !== undefined && { workingApproach: profile.workingApproach }),
        };
        return success({ ...content, citations: citationsFor(profile.sources, content) });
      }),
    );
  },
};

export const getExperience: ToolModule = {
  name: 'get_experience',
  register(server, context) {
    server.registerTool(
      'get_experience',
      {
        title: 'Get experience',
        description:
          'Employment history, education and certifications, as separate sections. ' +
          'Each role lists the responsibilities recorded on its linked projects, each with a `scope`: ' +
          'individual (Alex alone), collaborative (Alex with others) or team (a team result Alex contributed to). ' +
          'Keep that distinction when you answer.',
        inputSchema: {},
        outputSchema: GetExperienceOutput,
        annotations: READ_ONLY,
      },
      guarded('get_experience', context, () => {
        const experience = experienceOf(context.kb);
        return success({
          ...experience,
          employment: experience.employment.map((role) => ({
            ...role,
            projects: role.projects.map((project) => ({ ...project, uri: projectUri(project.id) })),
          })),
        });
      }),
    );
  },
};

export const getSkills: ToolModule = {
  name: 'get_skills',
  register(server, context) {
    server.registerTool(
      'get_skills',
      {
        title: 'Get skills',
        description:
          'Verified technical skills, each linked to the featured projects that demonstrate it. ' +
          'A skill with no projects is evidenced by the CV only. Optionally filter by category.',
        inputSchema: {
          category: SkillSchema.shape.category.optional().describe('Only return skills in this category'),
        },
        outputSchema: GetSkillsOutput,
        annotations: READ_ONLY,
      },
      guarded('get_skills', context, ({ category }) => {
        const { kb } = context;
        const skills = kb.skills
          .filter((skill) => category === undefined || skill.category === category)
          .map((skill) => ({
            ...skill,
            projects: skill.projects.map((id) => ({ id, name: kb.getProject(id)?.name ?? id, uri: projectUri(id) })),
          }));
        return success({ skills, citations: citationsFor(kb.skillSources, skills) });
      }),
    );
  },
};
