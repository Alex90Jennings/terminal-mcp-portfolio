import { citationsFor, PROVENANCE_LABELS, storyPartText, type KnowledgeBase, type STAR_PARTS, type Story } from '@portfolio/knowledge';
import { z } from 'zod';
import { projectUri } from '../uris.ts';
import { GetExamplesOutput } from './schemas.ts';
import { guarded, READ_ONLY, success, type ToolModule } from './shared.ts';

/** One published story, told short or detailed, with plain-language attribution and basis. Review metadata never leaves. */
export function exampleView(kb: KnowledgeBase, story: Story, version: 'short' | 'detailed') {
  const part = (name: (typeof STAR_PARTS)[number] | 'reflection') => {
    const value = story[name];
    return value === undefined ? undefined : { text: storyPartText(value, version), basis: PROVENANCE_LABELS[value.provenance], sources: value.sources };
  };
  const reflection = version === 'detailed' ? part('reflection') : undefined;
  return {
    id: story.id,
    title: story.title,
    ...(story.organisation !== undefined && { organisation: story.organisation }),
    projects: story.projects.map((id) => ({ id, name: kb.getProject(id)?.name ?? id, uri: projectUri(id) })),
    competencies: story.competencies.flatMap((id) => {
      const competency = kb.getCompetency(id);
      return competency ? [{ id: competency.id, name: competency.name }] : [];
    }),
    situation: part('situation')!,
    task: part('task')!,
    action: part('action')!,
    result: part('result')!,
    ...(reflection !== undefined && { reflection }),
    attribution: story.attribution,
    attributionNote: story.attributionNote,
  };
}

export const getExamples: ToolModule = {
  name: 'get_examples',
  register(server, context) {
    server.registerTool(
      'get_examples',
      {
        title: 'Get examples',
        description:
          'Real examples from Alex\'s work, told as Situation, Task, Action and Result, for questions about soft skills, ways of working and "tell me about a time". ' +
          'Filter by competency (e.g. "problem-solving"), project, keywords or story id; pass `exclude` with stories already told to get a different one. ' +
          'A `query` that names a competency in everyday words ("disagreements", "trade-offs", "a mistake") returns that competency\'s examples, most relevant first; ' +
          '`competency` in the result says which one was recognised and how many examples it has. ' +
          'Each part has a `basis`: "project records" (documented) or "Alex\'s own account" (firsthand, not independently verified); say which when it matters. ' +
          '`attributionNote` says who did what: keep it. `matched` counts every example that fits, so `complete: true` means nothing else matches. ' +
          'Competencies with no published example are absent: say so rather than inventing one.',
        inputSchema: {
          competency: z.string().trim().max(60).optional().describe('Competency id or name, e.g. "conflict-resolution" or "Problem-solving"'),
          project: z.string().trim().max(100).optional().describe('Project id, alias or name'),
          query: z.string().trim().max(200).optional().describe('Keywords, e.g. "production incident" or "deadlines"'),
          story: z.string().trim().max(60).optional().describe('One story by id'),
          exclude: z.array(z.string().max(60)).max(20).optional().describe('Story ids already told in this conversation'),
          version: z.enum(['short', 'detailed']).default('short').describe('short for a concise answer; detailed adds detail and any reflection'),
          limit: z.number().int().min(1).max(10).default(3),
        },
        outputSchema: GetExamplesOutput,
        annotations: READ_ONLY,
      },
      guarded('get_examples', context, ({ competency, project, query, story, exclude, version, limit }) => {
        const { kb } = context;
        const found =
          story !== undefined
            ? [kb.getStory(story)].filter((item): item is Story => item !== undefined && !exclude?.includes(item.id))
            : kb.findStories({ ...(competency !== undefined && { competency }), ...(project !== undefined && { project }), ...(query !== undefined && { query }), ...(exclude !== undefined && { exclude }) });
        const examples = found.slice(0, limit).map((item) => exampleView(kb, item, version));
        const about = story === undefined ? (competency !== undefined ? kb.getCompetency(competency) : query !== undefined ? kb.recogniseCompetency(query) : undefined) : undefined;
        const published = about?.stories.filter((id) => kb.getStory(id) !== undefined).length ?? 0;
        return success({
          examples,
          matched: found.length,
          returned: examples.length,
          complete: examples.length === found.length,
          ...(about !== undefined && { competency: { id: about.id, name: about.name, examples: published } }),
          ...(about?.gap !== undefined && { gap: about.gap }),
          citations: citationsFor(kb.evidence.sources, examples),
        });
      }),
    );
  },
};
