import { citationsFor, experienceOf, PROVENANCE_LABELS, SkillSchema, type Interest, type KnowledgeBase } from '@portfolio/knowledge';
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
          "A concise professional profile of Alex Jennings: summary, location, contact links, languages, how Alex works (including where AI fits in), " +
          "and, once published, Alex's interests, motivation and career goals (five years, next role, why Alex left ZIM, a long-term dream) and working style " +
          "(strengths, frustrations, the first six months in a new role), each from Alex's own account. " +
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
        const { interests, background } = context.kb.evidence;
        const personal = (items: readonly Interest[]) => items.map((item) => personalItem(context.kb, item));
        return success({
          ...content,
          interests: { personal: personal(interests.personal), technical: personal(interests.technical) },
          background: { motivation: personal(background.motivation), workingEnvironment: personal(background.workingEnvironment) },
          citations: [...citationsFor(profile.sources, content), ...citationsFor(context.kb.evidence.sources, [interests, background])],
        });
      }),
    );
  },
};

function personalItem(kb: KnowledgeBase, item: Interest) {
  return {
    title: item.title,
    text: item.text,
    projects: item.projects.map((id) => ({ id, name: kb.getProject(id)?.name ?? id, uri: projectUri(id) })),
    basis: PROVENANCE_LABELS[item.provenance],
  };
}

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
          'Keep that distinction when you answer. Certifications are split into `earned` (held; `earnedCount` is how many) ' +
          'and `inProgress` (being studied for, not held).',
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
          'A skill with no projects is evidenced by the CV only. Optionally filter by category. ' +
          'Also lists soft skills (`softSkills`), each with the examples that demonstrate it; tell an example with get_examples.',
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
        const softSkills = kb.evidence.competencies.map((competency) => ({
          id: competency.id,
          name: competency.name,
          group: competency.group,
          description: competency.description,
          examples: competency.stories.flatMap((id) => {
            const story = kb.getStory(id);
            return story ? [{ id: story.id, title: story.title }] : [];
          }),
          ...(competency.gap !== undefined && { gap: competency.gap }),
        }));
        return success({ skills, softSkills, citations: citationsFor(kb.skillSources, skills) });
      }),
    );
  },
};
