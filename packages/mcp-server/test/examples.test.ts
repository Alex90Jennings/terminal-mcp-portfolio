import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle, createKnowledgeBase, type Evidence } from '@portfolio/knowledge';
import { loadBundle, readContent } from '@portfolio/knowledge/node';
import { describe, expect, it } from 'vitest';
import { call, connect, structured } from './helpers.ts';

const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../content');
// The public server reads the published bundle; a preview server includes drafts for local review only.
const published = await loadBundle(contentDir);
const publicClient = await connect({}, createKnowledgeBase(published));
const previewClient = await connect({}, createKnowledgeBase(await loadBundle(contentDir, { includeDrafts: true })));
// The same content with every story and interest back in draft: what the public server served before Alex approved them.
const raw = await readContent(contentDir);
const drafts = structuredClone(raw.evidence!.data) as Evidence;
for (const item of [...drafts.stories, ...drafts.interests.personal, ...drafts.interests.technical, ...drafts.background.motivation, ...drafts.background.workingEnvironment]) {
  Object.assign(item, { status: 'needs-review', visibility: 'draft' });
}
const draftClient = await connect({}, createKnowledgeBase(buildBundle({ ...raw, evidence: { ...raw.evidence!, data: drafts } })));

type Examples = {
  examples: { id: string; title: string; situation: { text: string; basis: string }; result: { text: string; basis: string }; reflection?: unknown; attributionNote: string; attribution: string }[];
  matched: number;
  returned: number;
  complete: boolean;
  gap?: string;
};

describe('publication filtering at the MCP boundary', () => {
  it('serves no draft story, soft skill or interest from a public server', async () => {
    const examples = structured<Examples>(await call(draftClient, 'get_examples', { competency: 'problem-solving' }));
    expect(examples).toMatchObject({ examples: [], matched: 0, complete: true });
    expect(structured<{ softSkills: unknown[] }>(await call(draftClient, 'get_skills')).softSkills).toEqual([]);
    const profile = structured<{ interests: unknown; background: unknown }>(await call(draftClient, 'get_profile'));
    expect(profile.interests).toEqual({ personal: [], technical: [] });
    expect(profile.background).toEqual({ motivation: [], workingEnvironment: [] });
    for (const story of ['zim-black-friday', 'zim-sql-performance']) {
      expect(structured<Examples>(await call(draftClient, 'get_examples', { story })).examples).toEqual([]);
    }
  });

  it('serves the stories, soft skills and interests Alex approved (20 Oct 2026) from the public server', async () => {
    expect(structured<Examples>(await call(publicClient, 'get_examples', { competency: 'problem-solving' }))).toMatchObject({ matched: 7, complete: false });
    expect(structured<{ softSkills: unknown[] }>(await call(publicClient, 'get_skills')).softSkills).toHaveLength(17);
    const profile = structured<{ interests: { personal: unknown[]; technical: unknown[] }; background: { motivation: unknown[]; workingEnvironment: unknown[] } }>(await call(publicClient, 'get_profile'));
    expect(profile.interests.personal.length + profile.interests.technical.length).toBe(7);
    expect(profile.background.motivation.length + profile.background.workingEnvironment.length).toBe(2);
    const story = structured<Examples>(await call(publicClient, 'get_examples', { story: 'zim-black-friday', version: 'detailed' })).examples[0]!;
    expect(story.reflection).toMatchObject({ basis: "Alex's own account" });
    expect(story.attributionNote).toMatch(/oversight was a team one\. Alex personally investigated and implemented the fix/);
  });

  it('never exposes review status, visibility or raw provenance, even in a preview', async () => {
    for (const client of [publicClient, previewClient]) {
      for (const [tool, args] of [
        ['get_examples', { competency: 'collaboration', version: 'detailed', limit: 10 }],
        ['get_examples', { query: 'Black Friday SNS translation', version: 'detailed', limit: 10 }],
        ['get_skills', {}],
        ['get_profile', {}],
      ] as const) {
        const text = JSON.stringify(structured(await call(client, tool, args)));
        expect(text, tool).not.toMatch(/"status"\s*:\s*"(?:needs-review|approved|incomplete)"|"visibility"|"provenance"|"draft"/);
      }
      // A project record has its own published `visibility` (public or professional); the story review fields must still never appear.
      for (const [tool, args] of [
        ['get_project', { project: 'zim-connections', relatedTo: 'Did Alex reduce AWS costs or migrate notifications from Firebase?' }],
        ['search_projects', { query: 'Firebase Black Friday AWS' }],
      ] as const) {
        const text = JSON.stringify(structured(await call(client, tool, args)));
        expect(text, tool).not.toMatch(/needs-review|"provenance"|"draft"|"incomplete"/);
      }
    }
  });
});

describe('get_examples (preview content)', () => {
  it('tells the strongest example for a competency, short by default, with basis and attribution', async () => {
    const result = structured<Examples>(await call(previewClient, 'get_examples', { competency: 'problem-solving', limit: 1 }));
    expect(result).toMatchObject({ matched: 7, returned: 1, complete: false });
    const [example] = result.examples;
    expect(example).toMatchObject({ id: 'zim-sql-performance', attribution: 'individual' });
    expect(example!.result).toEqual({ text: 'Response times fell from roughly 2–9 seconds to 0.5–1.5 seconds.', basis: "Alex's own account", sources: ['alex-interview'] });
    expect(example!.reflection).toBeUndefined();
  });

  it('gives a different example when the ones already told are excluded', async () => {
    const first = structured<Examples>(await call(previewClient, 'get_examples', { competency: 'collaboration', limit: 1 })).examples[0]!.id;
    const second = structured<Examples>(await call(previewClient, 'get_examples', { competency: 'collaboration', exclude: [first], limit: 1 })).examples[0]!.id;
    expect(second).not.toBe(first);
  });

  it('adds detail and the reflection in the detailed version, from the same facts', async () => {
    const short = structured<Examples>(await call(previewClient, 'get_examples', { story: 'zim-multi-tenancy' })).examples[0]!;
    const detailed = structured<Examples>(await call(previewClient, 'get_examples', { story: 'zim-multi-tenancy', version: 'detailed' })).examples[0]!;
    expect(detailed.result.text.startsWith(short.result.text)).toBe(true);
    expect(detailed.reflection).toBeDefined();
    expect(detailed.attributionNote).toMatch(/collaborated with another developer/);
  });

  it('says what evidence is missing for a thin competency', async () => {
    const result = structured<Examples>(await call(previewClient, 'get_examples', { competency: 'handling-feedback' }));
    expect(result).toMatchObject({ matched: 1, complete: true });
    expect(result.gap).toMatch(/Who gave the advice isn't recorded/);
    expect(structured<Examples>(await call(previewClient, 'get_examples', { competency: 'conflict-resolution' })).gap).toBeUndefined();
  });

  it('finds examples by project and by keywords', async () => {
    expect(structured<Examples>(await call(previewClient, 'get_examples', { project: 'SOL' })).examples.map(({ id }) => id)).toEqual(['sol-accessibility']);
    expect(structured<Examples>(await call(previewClient, 'get_examples', { query: 'production incident Black Friday' })).examples.map(({ id }) => id)).toContain('zim-black-friday');
  });

  it('lists soft skills with their examples, strongest first', async () => {
    const { softSkills } = structured<{ softSkills: { id: string; examples: { id: string }[]; gap?: string }[] }>(await call(previewClient, 'get_skills'));
    expect(softSkills).toHaveLength(17);
    expect(softSkills.find(({ id }) => id === 'problem-solving')?.examples[0]?.id).toBe('zim-sql-performance');
  });

  it('includes interests and background, marked as Alex’s own account', async () => {
    const { interests, background } = structured<{ interests: { personal: { title: string; basis: string }[] }; background: { motivation: { text: string }[] } }>(
      await call(previewClient, 'get_profile'),
    );
    expect(interests.personal.map(({ title }) => title)).toEqual(['Building things', 'Learning Italian']);
    expect(interests.personal.every(({ basis }) => basis === "Alex's own account")).toBe(true);
    expect(background.motivation[0]?.text).toMatch(/economics and worked in finance/);
  });

  it('attributes the multi-tenant architecture consistently: collaborative in the project record, the experience view and the story', async () => {
    type Responsibilities = { text: string; scope: string }[];
    const { project } = structured<{ project: { responsibilities: Responsibilities } }>(await call(publicClient, 'get_project', { project: 'zim-connections', sections: ['responsibilities'] }));
    const record = project.responsibilities.find(({ text }) => /multi-tenant/.test(text));
    expect(record).toEqual(expect.objectContaining({ scope: 'collaborative', text: expect.stringMatching(/^Collaborated with another developer to design and implement ZIM's multi-tenant architecture/) }));
    const { employment } = structured<{ employment: { projects: { id: string; responsibilities: Responsibilities }[] }[] }>(await call(publicClient, 'get_experience'));
    const zim = employment.flatMap(({ projects }) => projects).find(({ id }) => id === 'zim-connections');
    expect(zim?.responsibilities.find(({ text }) => /multi-tenant/.test(text))?.scope).toBe('collaborative');
    const story = structured<Examples>(await call(previewClient, 'get_examples', { story: 'zim-multi-tenancy' })).examples[0]!;
    expect(story.attribution).toBe('collaborative');
    expect(story.attributionNote).toMatch(/collaborated with another developer.*not Alex's alone/);
    expect(JSON.stringify(story)).not.toMatch(/single-handedly|Alex's own work/);
  });

  it('is read-only like every other tool', async () => {
    const { tools } = await previewClient.listTools();
    expect(tools.find(({ name }) => name === 'get_examples')?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  });
});

describe('project tools point at examples', () => {
  it('search_projects finds a fact told only in an example', async () => {
    const preview = structured<{ results: unknown[]; examples?: { id: string; projects: string[] }[] }>(await call(previewClient, 'search_projects', { query: 'Firebase' }));
    expect(preview.examples?.map(({ id }) => id)).toContain('zim-sns-migration');
    expect(preview.examples?.find(({ id }) => id === 'zim-sns-migration')?.projects).toEqual(['zim-connections']);
  });

  it('a public server with no published examples adds nothing', async () => {
    const result = structured<Record<string, unknown>>(await call(draftClient, 'search_projects', { query: 'Firebase' }));
    expect(result).not.toHaveProperty('examples');
    const project = structured<Record<string, unknown>>(await call(draftClient, 'get_project', { project: 'zim-connections', relatedTo: 'Firebase migration' }));
    expect(project).toMatchObject({ complete: true });
    expect(project).not.toHaveProperty('examples');
    expect(project).not.toHaveProperty('relatedFromExamples');
    // No draft story text either: these facts are told only in unpublished examples.
    expect(JSON.stringify([result, project])).not.toMatch(/Black Friday|Firebase to AWS SNS|approximately 30%|CEO and CTO/);
  });
});

describe('competency retrieval from natural questions (regression: star-decisions, 2026-10-20)', () => {
  type Found = Examples & { competency?: { id: string; name: string; examples: number } };
  const ask = async (args: Record<string, unknown>) => structured<Found>(await call(publicClient, 'get_examples', args));
  const storiesOf = (id: string) => createKnowledgeBase(published).getCompetency(id)!.stories;

  it('the original failure: a keyword query about technical decisions returns the decision stories, not the catalogue’s first three', async () => {
    const result = await ask({ query: 'technical decisions trade-offs architecture choice' });
    expect(result.competency).toMatchObject({ id: 'technical-decision-making', examples: 6 });
    expect(result.matched).toBe(6);
    for (const { id } of result.examples) expect(storiesOf('technical-decision-making')).toContain(id);
    expect(result.examples.map(({ id }) => id)).not.toEqual(['zim-sbb-feature-scope', 'zim-aws-cost-review', 'zim-sql-performance']);
  });

  it.each([
    ['collaboration', 'Give an example of Alex working with a colleague.'],
    ['communication', 'How does Alex communicate technical constraints?'],
    ['problem-solving', 'Describe a difficult technical problem Alex solved.'],
    ['attention-to-detail', 'How thorough is Alex? Tell me about a time Alex caught a defect.'],
    ['ownership', 'Tell me about a project Alex owned end to end.'],
    ['adaptability', 'Describe a time Alex changed approach.'],
    ['prioritisation', 'How does Alex handle competing priorities?'],
    ['conflict-resolution', 'Tell me about a time Alex resolved a disagreement.'],
    ['handling-feedback', 'Tell me about a time Alex received feedback.'],
    ['learning-from-failure', 'Tell me about a mistake Alex learned from.'],
    ['initiative', 'Describe a time Alex demonstrated initiative.'],
    ['customer-focus', 'How does Alex consider end users?'],
    ['balancing-speed-and-quality', 'Tell me about a time Alex balanced speed and quality.'],
    ['working-with-ambiguity', 'How does Alex handle unclear requirements?'],
    ['technical-decision-making', "Describe Alex's approach to technical decision-making."],
    ['cross-functional-ownership', 'How does Alex take a feature from idea to production?'],
    ['continuous-improvement', 'Tell me about a system Alex improved.'],
  ])('%s: "%s" retrieves that competency’s own examples', async (id, question) => {
    const result = await ask({ query: question, limit: 10 });
    expect(result.competency?.id).toBe(id);
    expect(result.examples.length).toBeGreaterThan(0);
    for (const { id: story } of result.examples) expect(storiesOf(id)).toContain(story);
  });

  it.each([
    ['handling feedback retrieves the estimation story', 'Has Alex received constructive criticism?', 'zim-estimates-feedback'],
    ['conflict resolution retrieves the ZIM@SBB scope discussion', 'How does Alex handle disagreements?', 'zim-sbb-feature-scope'],
    ['collaboration retrieves a collaborative example', 'How does Alex work with other developers?', 'zim-multi-tenancy'],
    ['the rest of the question ranks within a competency', 'Tell me about a time Alex improved performance.', 'zim-sql-performance'],
  ])('%s', async (_, question, expected) => {
    expect((await ask({ query: question })).examples[0]?.id).toBe(expected);
  });

  it('learning from failure says no personal mistake is documented, rather than inventing one', async () => {
    const result = await ask({ query: 'Tell me about a time Alex made a mistake.' });
    expect(result.competency?.id).toBe('learning-from-failure');
    expect(result.gap).toMatch(/No personal mistake by Alex is documented/);
    expect(result.examples[0]?.attributionNote).toMatch(/oversight was a team one/);
  });

  it('"another example" never repeats one already told, and says when there are no more', async () => {
    const first = await ask({ query: 'Give me an example of problem-solving.', limit: 1 });
    const second = await ask({ query: 'Give me another example of problem-solving.', limit: 1, exclude: [first.examples[0]!.id] });
    expect(second.examples[0]!.id).not.toBe(first.examples[0]!.id);
    expect(second.matched).toBe(first.matched - 1);
    const only = await ask({ query: 'disagreement', exclude: ['zim-sbb-feature-scope'] });
    expect(only).toMatchObject({ examples: [], matched: 0, complete: true, competency: { id: 'conflict-resolution', examples: 1 } });
  });

  it('keeps keyword search for questions that name no competency, ranked by relevance', async () => {
    const result = await ask({ query: 'Black Friday promotion' });
    expect(result.competency).toBeUndefined();
    expect(result.examples[0]?.id).toBe('zim-black-friday');
    expect((await ask({ query: 'telepathy' })).examples).toEqual([]);
  });
});
