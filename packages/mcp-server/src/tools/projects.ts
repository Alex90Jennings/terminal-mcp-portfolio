import { citationsFor, PROJECT_DATA_SECTIONS, projectHeader, selectProjectSections } from '@portfolio/knowledge';
import { z } from 'zod';
import { projectUri } from '../uris.ts';
import { GetProjectOutput, ListProjectsOutput, SearchProjectsOutput, SectionName } from './schemas.ts';
import { guarded, projectLink, READ_ONLY, success, unknownProject, type ToolModule } from './shared.ts';

export const listProjects: ToolModule = {
  name: 'list_projects',
  register(server, context) {
    server.registerTool(
      'list_projects',
      {
        title: 'List featured projects',
        description:
          "List Alex Jennings' six featured engineering projects with each one's primary technical focus, tagline and tags. " +
          'Start here to find a project id for get_project.',
        inputSchema: {},
        outputSchema: ListProjectsOutput,
        annotations: READ_ONLY,
      },
      guarded('list_projects', context, () => {
        const { kb } = context;
        const projects = kb.projects.map((project) => ({ ...projectHeader(project), uri: projectUri(project.id) }));
        return success({ projects }, kb.projects.map(projectLink));
      }),
    );
  },
};

/** Every project id with its name, so a model picks the right one instead of guessing from an example. */
const projectIdList = (projects: readonly { id: string; name: string }[]) => projects.map(({ id, name }) => `"${id}" (${name})`).join(', ');

export const getProject: ToolModule = {
  name: 'get_project',
  register(server, context) {
    server.registerTool(
      'get_project',
      {
        title: 'Get a project',
        description:
          'Get verified details of one project. Pass `sections` to fetch only what you need, e.g. ["architecture", "decisions"]; ' +
          'omit it for everything. Every fact cites source ids, resolved in `citations`. ' +
          'Responsibilities carry a `scope`: individual (Alex alone), collaborative (Alex with others) or team (a team result Alex contributed to). ' +
          '`undocumented` lists topics with no verified information: say so rather than guessing.',
        inputSchema: {
          project: z
            .string()
            .trim()
            .min(1)
            .max(100)
            .describe(`Project id, alias, display name or listing number. The ids: ${projectIdList(context.kb.projects)}`),
          sections: z
            .array(SectionName)
            .min(1)
            .max(PROJECT_DATA_SECTIONS.length)
            .optional()
            .describe(`Sections to include. Any of: ${PROJECT_DATA_SECTIONS.join(', ')}`),
        },
        outputSchema: GetProjectOutput,
        annotations: READ_ONLY,
      },
      guarded('get_project', context, ({ project: input, sections }) => {
        const { kb } = context;
        const project = kb.getProject(input);
        if (project === undefined) return unknownProject(kb, input);

        const included = PROJECT_DATA_SECTIONS.filter((section) => sections === undefined || sections.includes(section));
        const selection = selectProjectSections(project, included);
        return success(
          { project: selection, sections: included, uri: projectUri(project.id), citations: citationsFor(project.sources, selection) },
          [projectLink(project)],
        );
      }),
    );
  },
};

export const searchProjects: ToolModule = {
  name: 'search_projects',
  register(server, context) {
    server.registerTool(
      'search_projects',
      {
        title: 'Search projects',
        description:
          'Keyword search across project names, focus, technologies, overviews, responsibilities, architecture, challenges, decisions, lessons and limitations. ' +
          'Returns the best-matching projects with the passages that matched and their sources. ' +
          'Use specific terms ("Terraform", "accessibility", "multi-tenancy"); follow up with get_project for detail.',
        inputSchema: {
          query: z.string().trim().min(1).max(200).describe('What to look for, e.g. "Docker" or "React Native experience"'),
          limit: z.number().int().min(1).max(10).default(5).describe('Maximum number of projects to return (1–10)'),
        },
        outputSchema: SearchProjectsOutput,
        annotations: READ_ONLY,
      },
      guarded('search_projects', context, ({ query, limit }) => {
        const { kb } = context;
        const results = kb.search(query, limit).map((hit) => {
          const project = kb.getProject(hit.projectId);
          return {
            projectId: hit.projectId,
            projectName: hit.projectName,
            score: hit.score,
            uri: projectUri(hit.projectId),
            matches: hit.matches.map((match) => ({ field: match.field, text: match.text, sources: match.sources })),
            citations: project ? citationsFor(project.sources, hit.matches) : [],
          };
        });
        const links = results.flatMap(({ projectId }) => {
          const project = kb.getProject(projectId);
          return project ? [projectLink(project)] : [];
        });
        return success({ query, results }, links);
      }),
    );
  },
};
