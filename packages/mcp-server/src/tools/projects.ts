import { citationsFor, PROJECT_DATA_SECTIONS, PROVENANCE_LABELS, projectHeader, selectProjectSections, type ProjectDataSection, type SearchField } from '@portfolio/knowledge';
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
          "List Alex Jennings' featured engineering projects with each one's primary technical focus, tagline and tags. " +
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

// Sections the keyword index covers; `links` and `undocumented` aren't searched.
const SEARCHABLE = new Set<string>(['overview', 'technologies', 'responsibilities', 'architecture', 'challenges', 'decisions', 'lessons', 'limitations']);

/** Whether a section has anything in it: an empty list or an object of empty lists doesn't count. */
const hasContent = (value: unknown): boolean =>
  Array.isArray(value) ? value.length > 0 : typeof value === 'object' && value !== null ? Object.values(value).some(hasContent) : typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null;

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
          'A partial result lists `omittedSections` and has `complete: false`: fetch those sections before concluding something is not documented. ' +
          '`examples` lists real examples about the project, told by get_examples; they can hold facts the record does not, so check them too. ' +
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
          relatedTo: z
            .string()
            .trim()
            .max(500)
            .optional()
            .describe("The question being answered. Passages that match it are added from omitted sections and from the project's examples"),
        },
        outputSchema: GetProjectOutput,
        annotations: READ_ONLY,
      },
      guarded('get_project', context, ({ project: input, sections, relatedTo }) => {
        const { kb } = context;
        const project = kb.getProject(input);
        if (project === undefined) return unknownProject(kb, input);

        const included = PROJECT_DATA_SECTIONS.filter((section) => sections === undefined || sections.includes(section));
        const selection = selectProjectSections(project, included);
        // A partial record must say so: what isn't here may still be documented.
        const omittedSections = PROJECT_DATA_SECTIONS.filter((section) => !included.includes(section) && hasContent(project[section]));
        const complete = omittedSections.length === 0;
        const searchable = omittedSections.filter((section): section is SearchField & ProjectDataSection => SEARCHABLE.has(section));
        const related = !complete && relatedTo ? kb.searchWithin(project.id, relatedTo, searchable) : [];
        const relatedFromOmitted = related.map(({ field, text, sources: ids }) => ({ section: field, text, sources: ids }));
        // Published examples about the project can document what its record doesn't (an incident, a migration).
        const examples = kb.findStories({ project: project.id }).map(({ id, title }) => ({ id, title }));
        const relatedFromExamples = relatedTo
          ? kb.searchStories(relatedTo, { project: project.id }).map(({ story, part, text }) => {
              const value = story[part]!;
              return { example: story.id, part, text, basis: PROVENANCE_LABELS[value.provenance], sources: value.sources };
            })
          : [];
        const notes = [
          ...(complete ? [] : [`Partial record: ${omittedSections.join(', ')} not included. Fetch them before saying this project doesn't document something.`]),
          ...(examples.length > 0 ? [`${examples.length} example${examples.length === 1 ? '' : 's'} about this project can hold facts the record doesn't: check them with get_examples before saying something isn't documented.`] : []),
        ];
        return success(
          {
            project: selection,
            sections: included,
            omittedSections,
            complete: complete && examples.length === 0,
            ...(notes.length > 0 && { note: notes.join(' ') }),
            ...(relatedFromOmitted.length > 0 && { relatedFromOmitted }),
            ...(examples.length > 0 && { examples }),
            ...(relatedFromExamples.length > 0 && { relatedFromExamples }),
            uri: projectUri(project.id),
            citations: [...citationsFor(project.sources, [selection, related]), ...citationsFor(kb.evidence.sources, relatedFromExamples)].filter(
              (citation, index, all) => all.findIndex((other) => other.id === citation.id) === index,
            ),
          },
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
        // Examples are searched too: a fact told only in an example (a migration, an incident) is still documented.
        const examples = [...new Map(kb.searchStories(query, { limit: 3 }).map(({ story }) => [story.id, story])).values()].map(({ id, title, projects }) => ({ id, title, projects: [...projects] }));
        return success({ query, results, ...(examples.length > 0 && { examples }) }, links);
      }),
    );
  },
};
