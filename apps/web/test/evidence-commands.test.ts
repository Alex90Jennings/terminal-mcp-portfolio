import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle, createKnowledgeBase, type Evidence } from '@portfolio/knowledge';
import { loadBundle, readContent } from '@portfolio/knowledge/node';
import { describe, expect, it } from 'vitest';
import { guardPreview, serverKb } from '@/server/knowledge';
import { commandsIn, output, run } from './helpers';

const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../content');
const preview = createKnowledgeBase(await loadBundle(contentDir, { includeDrafts: true }));
const inPreview = { kb: preview };
// The same content with every story and interest back in draft: the site before Alex approved them.
const raw = await readContent(contentDir);
const drafts = structuredClone(raw.evidence!.data) as Evidence;
for (const item of [...drafts.stories, ...drafts.interests.personal, ...drafts.interests.technical, ...drafts.background.motivation, ...drafts.background.workingEnvironment]) {
  Object.assign(item, { status: 'needs-review', visibility: 'draft' });
}
const unpublished = { kb: createKnowledgeBase(buildBundle({ ...raw, evidence: { ...raw.evidence!, data: drafts } })) };

describe('the published site', () => {
  it.each([
    ['/soft-skills', /No soft-skill examples are published yet/],
    ['/stories', /No stories are published yet/],
    ['/interests', /No interests are published yet/],
  ])('with nothing approved, %s says nothing is published, without showing drafts', (input, message) => {
    const text = output(input, unpublished);
    expect(text).toMatch(message);
    expect(text).not.toMatch(/Preview|Black Friday|IKEA/);
  });

  it('shows everything Alex approved (20 Oct 2026), without a preview notice', () => {
    const skills = output('/soft-skills');
    expect(skills).toMatch(/01 Collaboration/);
    expect(skills).toMatch(/13 Self-awareness/);
    expect(skills).toMatch(/18 Continuous improvement/);
    expect(commandsIn(run('/stories').blocks).filter((command) => command.startsWith('/stories '))).toHaveLength(19);
    const interests = output('/interests');
    for (const title of ['Building things', 'Learning Italian', 'Motivation and goals', 'Five years from now', 'Working style', 'What frustrates Alex']) expect(interests).toContain(title);
    for (const input of ['/soft-skills', '/stories', '/interests', '/stories zim-black-friday full']) expect(output(input), input).not.toMatch(/Preview/);
  });

  it('tells the confirmed Black Friday and ZIM@SBB details', () => {
    const friday = output('/stories zim-black-friday full');
    expect(friday).toMatch(/about 30 minutes/);
    expect(friday).toMatch(/about 30 minutes[^\n]*existing customer entitlements/);
    expect(friday).toMatch(/oversight was a team one\. Alex personally investigated and implemented the fix/);
    expect(output('/stories zim-sbb-quality')).toMatch(/During pre-release testing, Alex identified two defects/);
  });

  it('lists the new commands in help and links them from about', () => {
    const help = output('/help');
    for (const name of ['/soft-skills', '/stories', '/interests']) expect(help).toContain(name);
    expect(commandsIn(run('/about').blocks)).toEqual(expect.arrayContaining(['/soft-skills', '/interests']));
  });

  it('serves the published bundle on the server, and refuses a preview bundle on a deployment', () => {
    expect(serverKb.preview).toBe(false);
    expect(() => guardPreview(preview, { VERCEL: '1' })).toThrow(/Refusing a preview knowledge bundle/);
    expect(() => guardPreview(preview, { VERCEL_ENV: 'preview' })).toThrow(/Refusing a preview knowledge bundle/);
    expect(() => guardPreview(preview, { NODE_ENV: 'production' })).toThrow(/Refusing a preview knowledge bundle/);
    expect(guardPreview(preview, {})).toBe(preview);
  });
});

describe('/soft-skills (preview)', () => {
  it('lists the 18 competencies in two groups, each linked, with a preview notice', () => {
    const result = run('/soft-skills', inPreview);
    const text = output('/soft-skills', inPreview);
    expect(text).toMatch(/^Preview: draft stories/);
    expect(text).toMatch(/Soft skills\n01 Collaboration/);
    expect(text).toMatch(/Engineering & product mindset\n14 Balancing speed and quality/);
    expect(commandsIn(result.blocks)).toEqual(expect.arrayContaining(['/soft-skills collaboration', '/soft-skills continuous-improvement']));
  });

  it.each(['/soft-skills problem-solving', '/soft-skills Problem-solving', '/soft-skills 3'])('%s shows the strongest example as one paragraph, then more examples', (input) => {
    const text = output(input, inPreview);
    expect(text).toMatch(/Problem-solving\nFinding the real cause/);
    expect(text).toMatch(/Speeding up the eSIM retrieval endpoint\n[^\n]*\nAt ZIM, the API endpoint[^\n]*Response times fell from roughly 2–9 seconds to 0\.5–1\.5 seconds\./);
    expect(text).not.toMatch(/^(Situation|Task|Action|Result)$/m);
    expect(text).toMatch(/Based on Alex's own account/);
    expect(text).toMatch(/More examples/);
  });

  it('shows a stated evidence gap for a thin competency, and none where the evidence suffices', () => {
    expect(output('/soft-skills handling-feedback', inPreview)).toMatch(/Evidence gap: One example\. Who gave the advice isn't recorded\./);
    expect(output('/soft-skills conflict-resolution', inPreview)).not.toMatch(/Evidence gap/);
  });

  it('lists interview questions, for one competency or all', () => {
    expect(output('/soft-skills questions feedback'.replace('feedback', 'handling-feedback'), inPreview)).toMatch(/Questions: Handling feedback[\s\S]*constructive criticism[\s\S]*Best answered by: Leaving room in estimates/);
    expect(output('/soft-skills questions', inPreview)).toMatch(/Interview questions[\s\S]*Collaboration[\s\S]*Continuous improvement/);
  });

  it('explains an unknown competency', () => {
    expect(output('/soft-skills telepathy', inPreview)).toMatch(/No soft skill called "telepathy"/);
  });
});

describe('/stories (preview)', () => {
  it.each(['/stories', '/stories list'])('%s lists the stories with attribution', (input) => {
    const text = output(input, inPreview);
    expect(text).toMatch(/Stories\n\[1\] Agreeing the scope of the white-label apps/);
    expect(commandsIn(run(input, inPreview).blocks)).toContain('/stories zim-sql-performance');
  });

  it.each(['/stories zim-sql-performance', '/stories show zim-sql-performance'])('%s tells the short version as one paragraph, without part labels', (input) => {
    const text = output(input, inPreview);
    expect(text).toMatch(/\nAt ZIM, the API endpoint[^\n]*Response times fell/);
    expect(text).not.toMatch(/\b(Situation|Task|Action|Result|Reflection)\b|STAR/);
    expect(text).toMatch(/Who did what: Alex's own investigation and optimisation\./);
  });

  it('tells the detailed version on request, with the reflection in the same paragraph, and offers it from the short one', () => {
    expect(commandsIn(run('/stories zim-multi-tenancy', inPreview).blocks)).toContain('/stories zim-multi-tenancy full');
    const full = output('/stories zim-multi-tenancy full', inPreview);
    expect(full).toMatch(/celebrating each step[^\n]*Alex's lesson/);
    expect(full).toMatch(/celebrating each step/);
    expect(full).toMatch(/Who did what: Alex collaborated with another developer/);
  });

  it('tells the action in full even in the short version, so most of the story is what Alex did', () => {
    const story = preview.getStory('clash-fair-benchmarking')!;
    expect(story.action.detail).toBeDefined();
    expect(output('/stories clash-fair-benchmarking', inPreview)).toContain(`${story.action.text} ${story.action.detail}`);
  });

  it('explains an unknown story', () => {
    expect(output('/stories nope', inPreview)).toMatch(/No story called "nope"/);
  });
});

describe('/interests (preview)', () => {
  it('separates personal and technical interests, motivation and working style', () => {
    const text = output('/interests', inPreview);
    expect(text).toMatch(/Personal interests\nBuilding things[\s\S]*Learning Italian/);
    expect(text).toMatch(/Technical interests\nCreative problem-solving[\s\S]*Native applications and accessibility/);
    expect(text).toMatch(/Motivation and goals\nFrom finance to software/);
    expect(text).toMatch(/Working style/);
    expect(text).toMatch(/From Alex's own account\./);
    expect(commandsIn(run('/interests', inPreview).blocks)).toEqual(expect.arrayContaining(['/projects sol', '/projects total-guess']));
  });
});

describe('weaknesses (Self-awareness)', () => {
  it.each(['What are your weaknesses?', "What is Alex's biggest weakness?", 'What are you working on to improve?', 'What is something Alex could do better?'])(
    '"%s" finds the estimates story',
    (question) => {
      expect(serverKb.recogniseCompetency(question)?.id).toBe('self-awareness');
      expect(serverKb.findStories({ query: question }).map(({ id }) => id)).toContain('zim-estimates-feedback');
    },
  );

  it('names the competency a query mentions first when two match equally (the live 2026-10-20 miss)', () => {
    expect(serverKb.recogniseCompetency('weakness, a mistake, something Alex struggled with')?.id).toBe('self-awareness');
    expect(serverKb.findStories({ query: 'weakness, a mistake, something Alex struggled with' })[0]?.id).toBe('zim-estimates-feedback');
    expect(serverKb.recogniseCompetency('a mistake or a weakness')?.id).toBe('learning-from-failure');
    expect(serverKb.recogniseCompetency('Tell me about a technical decision Alex made.')?.id).toBe('technical-decision-making');
  });

  it('keeps continuous-improvement questions where they were', () => {
    expect(serverKb.recogniseCompetency('How does Alex improve working practices?')?.id).toBe('continuous-improvement');
    expect(serverKb.recogniseCompetency('Tell me about a system Alex improved.')?.id).toBe('continuous-improvement');
  });

  it('tells the weakness as Alex’s own account, in one paragraph', () => {
    const text = output('/stories zim-estimates-feedback');
    expect(text).toMatch(/Leaving room in estimates[\s\S]*Alex's estimates didn't leave enough room for the unexpected or for testing[^\n]*about four\./);
    expect(text).toMatch(/Based on Alex's own account/);
  });
});

describe('common behavioural questions (techinterviewhandbook.org) reach the right example', () => {
  it.each([
    ['Tell me about a time you had a disagreement with your manager.', 'zim-cto-release'],
    ['Tell me about a time when you had a conflict with a co-worker.', 'zim-cto-release'],
    ['Tell me about a time you disagreed with stakeholders.', 'zim-sbb-feature-scope'],
    ["Tell me about a time you needed information from someone who wasn't responsive.", 'zim-sbb-waiting'],
    ['What is something that you had to push for in your previous projects?', 'zim-aws-cost-review'],
    ['Tell me about a time your work responsibilities got a little overwhelming.', 'zim-estimates-feedback'],
    ['What was the most difficult bug that you fixed in the past 6 months?', 'zim-black-friday'],
    ['What is something you had to persevere at for multiple months?', 'zim-multi-tenancy'],
    ['What is the most constructive feedback you have received in your career?', 'zim-estimates-feedback'],
    ['What is your biggest weakness?', 'zim-estimates-feedback'],
    ['How has your use of AI changed?', 'ai-working-practice'],
  ])('%s → %s', (question, story) => {
    expect(serverKb.findStories({ query: question })[0]?.id).toBe(story);
  });

  it('a second weakness, once the first is told, is the AI one', () => {
    expect(serverKb.findStories({ query: 'What is another weakness?', exclude: ['zim-estimates-feedback'] })[0]?.id).toBe('ai-working-practice');
  });
});
