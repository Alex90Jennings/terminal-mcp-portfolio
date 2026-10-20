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
    ['soft-skills', /No soft-skill examples are published yet/],
    ['star', /No stories are published yet/],
    ['interests', /No interests are published yet/],
  ])('with nothing approved, %s says nothing is published, without showing drafts', (input, message) => {
    const text = output(input, unpublished);
    expect(text).toMatch(message);
    expect(text).not.toMatch(/Preview|Black Friday|IKEA/);
  });

  it('shows everything Alex approved (20 Oct 2026), without a preview notice', () => {
    const skills = output('soft-skills');
    expect(skills).toMatch(/01 Collaboration/);
    expect(skills).toMatch(/17 Continuous improvement/);
    expect(commandsIn(run('star').blocks).filter((command) => command.startsWith('star '))).toHaveLength(16);
    const interests = output('interests');
    for (const title of ['Building things', 'Learning Italian', 'Why software', 'Working style']) expect(interests).toContain(title);
    for (const input of ['soft-skills', 'star', 'interests', 'star zim-black-friday full']) expect(output(input), input).not.toMatch(/Preview/);
  });

  it('tells the confirmed Black Friday and ZIM@SBB details', () => {
    const friday = output('star zim-black-friday full');
    expect(friday).toMatch(/about 30 minutes/);
    expect(friday).toMatch(/Reflection\n.*existing customer entitlements/);
    expect(friday).toMatch(/oversight was a team one\. Alex personally investigated and implemented the fix/);
    expect(output('star zim-sbb-quality')).toMatch(/During pre-release testing, Alex identified two defects/);
  });

  it('lists the new commands in help and links them from about', () => {
    const help = output('help');
    for (const name of ['soft-skills', 'star', 'interests']) expect(help).toContain(name);
    expect(commandsIn(run('about').blocks)).toEqual(expect.arrayContaining(['soft-skills', 'interests']));
  });

  it('serves the published bundle on the server, and refuses a preview bundle on a deployment', () => {
    expect(serverKb.preview).toBe(false);
    expect(() => guardPreview(preview, { VERCEL: '1' })).toThrow(/Refusing a preview knowledge bundle/);
    expect(() => guardPreview(preview, { VERCEL_ENV: 'preview' })).toThrow(/Refusing a preview knowledge bundle/);
    expect(() => guardPreview(preview, { NODE_ENV: 'production' })).toThrow(/Refusing a preview knowledge bundle/);
    expect(guardPreview(preview, {})).toBe(preview);
  });
});

describe('soft-skills (preview)', () => {
  it('lists the 17 competencies in two groups, each linked, with a preview notice', () => {
    const result = run('soft-skills', inPreview);
    const text = output('soft-skills', inPreview);
    expect(text).toMatch(/^Preview: draft stories/);
    expect(text).toMatch(/Soft skills\n01 Collaboration/);
    expect(text).toMatch(/Engineering & product mindset\n13 Balancing speed and quality/);
    expect(commandsIn(result.blocks)).toEqual(expect.arrayContaining(['soft-skills collaboration', 'soft-skills continuous-improvement']));
  });

  it.each(['soft-skills problem-solving', 'soft-skills Problem-solving', 'soft-skills 3'])('%s shows the strongest example as STAR, then more examples', (input) => {
    const text = output(input, inPreview);
    expect(text).toMatch(/Problem-solving\nFinding the real cause/);
    expect(text).toMatch(/Speeding up the eSIM retrieval endpoint[\s\S]*Situation[\s\S]*Task[\s\S]*Action[\s\S]*Result\nResponse times fell from roughly 2–9 seconds to 0\.5–1\.5 seconds\./);
    expect(text).toMatch(/Based on Alex's own account/);
    expect(text).toMatch(/More examples/);
  });

  it('shows a stated evidence gap for a thin competency, and none where the evidence suffices', () => {
    expect(output('soft-skills handling-feedback', inPreview)).toMatch(/Evidence gap: One example\. Who gave the advice isn't recorded\./);
    expect(output('soft-skills conflict-resolution', inPreview)).not.toMatch(/Evidence gap/);
  });

  it('lists interview questions, for one competency or all', () => {
    expect(output('soft-skills questions feedback'.replace('feedback', 'handling-feedback'), inPreview)).toMatch(/Questions: Handling feedback[\s\S]*constructive criticism[\s\S]*Best answered by: Building contingency into estimates/);
    expect(output('soft-skills questions', inPreview)).toMatch(/Interview questions[\s\S]*Collaboration[\s\S]*Continuous improvement/);
  });

  it('explains an unknown competency', () => {
    expect(output('soft-skills telepathy', inPreview)).toMatch(/No soft skill called "telepathy"/);
  });
});

describe('star (preview)', () => {
  it.each(['star', 'star list'])('%s lists the stories with attribution', (input) => {
    const text = output(input, inPreview);
    expect(text).toMatch(/Stories\n\[1\] Agreeing the scope of the white-label apps/);
    expect(commandsIn(run(input, inPreview).blocks)).toContain('star zim-sql-performance');
  });

  it.each(['star zim-sql-performance', 'star show zim-sql-performance'])('%s tells the short version', (input) => {
    const text = output(input, inPreview);
    expect(text).toMatch(/Situation\nAt ZIM, the API endpoint/);
    expect(text).toMatch(/Who did what: Alex's own investigation and optimisation\./);
  });

  it('tells the detailed version on request, with the reflection, and offers it from the short one', () => {
    expect(commandsIn(run('star zim-multi-tenancy', inPreview).blocks)).toContain('star zim-multi-tenancy full');
    const full = output('star zim-multi-tenancy full', inPreview);
    expect(full).toMatch(/Reflection\nAlex's lesson/);
    expect(full).toMatch(/celebrating each step/);
    expect(full).toMatch(/Who did what: Alex collaborated with another developer/);
  });

  it('explains an unknown story', () => {
    expect(output('star nope', inPreview)).toMatch(/No story called "nope"/);
  });
});

describe('interests (preview)', () => {
  it('separates personal and technical interests, motivation and working style', () => {
    const text = output('interests', inPreview);
    expect(text).toMatch(/Personal interests\nBuilding things[\s\S]*Learning Italian/);
    expect(text).toMatch(/Technical interests\nCreative problem-solving[\s\S]*Native applications and accessibility/);
    expect(text).toMatch(/Why software\nFrom finance to software/);
    expect(text).toMatch(/Working style/);
    expect(text).toMatch(/From Alex's own account\./);
    expect(commandsIn(run('interests', inPreview).blocks)).toEqual(expect.arrayContaining(['projects sol', 'projects total-guess']));
  });
});
