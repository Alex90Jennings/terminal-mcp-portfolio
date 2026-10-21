import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildBundle, isPublished } from '../src/bundle.ts';
import { createKnowledgeBase } from '../src/knowledge-base.ts';
import { loadBundle, readContent } from '../src/load.ts';
import type { Evidence, Story } from '../src/schema.ts';
import { STAR_PARTS, storyBasis, storyParts, storyText } from '../src/views.ts';
import { content, project } from './fixtures.ts';

const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../content');
const authored = (await readContent(contentDir)).evidence!.data as Evidence;
const published = await loadBundle(contentDir);
const preview = await loadBundle(contentDir, { includeDrafts: true });

const FIGURE = /(?<![\d.,])\d[\d,]*(?:\.\d+)?%?/g;
const digits = (value: string) => value.replace(/,/g, '');

describe('the STAR catalogue in content/evidence.json', () => {
  it('has the 18 stories and all 18 competencies, every competency with stories or a stated gap', () => {
    expect(authored.stories).toHaveLength(18);
    expect(authored.competencies.map(({ id }) => id)).toEqual([
      'collaboration', 'communication', 'problem-solving', 'attention-to-detail', 'ownership', 'adaptability', 'prioritisation',
      'conflict-resolution', 'handling-feedback', 'learning-from-failure', 'initiative', 'customer-focus', 'self-awareness',
      'balancing-speed-and-quality', 'working-with-ambiguity', 'technical-decision-making', 'cross-functional-ownership', 'continuous-improvement',
    ]);
    for (const competency of authored.competencies) {
      expect(competency.stories.length > 0 || competency.gap !== undefined, competency.id).toBe(true);
      expect(competency.questions.length, competency.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('publishes every story and interest Alex approved (20 and 21 Oct 2026), and nothing else', () => {
    for (const story of authored.stories) expect({ id: story.id, status: story.status, visibility: story.visibility }).toEqual({ id: story.id, status: 'approved', visibility: 'public' });
    const interests = [...authored.interests.personal, ...authored.interests.technical, ...authored.background.motivation, ...authored.background.workingEnvironment];
    expect(interests).toHaveLength(17);
    for (const item of interests) expect(isPublished(item), item.id).toBe(true);
  });

  it('gives every story all four STAR parts, each with a source and a provenance', () => {
    for (const story of authored.stories) {
      for (const part of STAR_PARTS) {
        expect(story[part].text.length, `${story.id}.${part}`).toBeGreaterThan(10);
        expect(story[part].sources.length, `${story.id}.${part}`).toBeGreaterThan(0);
        expect(['documented', 'firsthand', 'inferred'], `${story.id}.${part}`).toContain(story[part].provenance);
      }
      expect(story.attributionNote.length, story.id).toBeGreaterThan(10);
    }
  });

  it('drafts no inferred narrative: every part is documented or Alex’s own account', () => {
    for (const story of authored.stories) for (const { part, provenance } of storyParts(story, 'detailed')) expect(provenance, `${story.id}.${part}`).not.toBe('inferred');
  });

  it('keeps documented parts consistent with the project records: every figure is in a linked project', () => {
    const projectText = (story: Story) => digits(JSON.stringify(story.projects.map((id) => preview.projects.find((p) => p.id === id))) + JSON.stringify(preview.profile));
    for (const story of authored.stories) {
      for (const part of [...STAR_PARTS, 'reflection'] as const) {
        const value = story[part];
        if (value?.provenance !== 'documented') continue;
        for (const figure of `${value.text} ${value.detail ?? ''}`.match(FIGURE) ?? []) {
          if (digits(figure).replace('%', '').length < 2) continue;
          expect(projectText(story), `${story.id}.${part}: ${figure}`).toContain(digits(figure));
        }
      }
    }
  });

  it('dates the live chat usage figures and never claims SOL is fully accessible or certified', () => {
    const chat = authored.stories.find(({ id }) => id === 'zim-live-chat')!;
    expect(chat.result.text).toMatch(/As of September 2026/);
    const sol = storyText(authored.stories.find(({ id }) => id === 'sol-accessibility')!, 'detailed');
    expect(sol).toMatch(/isn't fully verified/);
    expect(sol).not.toMatch(/fully accessible|certified/i);
  });

  it('keeps the attribution limits Alex asked for', () => {
    const note = (id: string) => authored.stories.find((story) => story.id === id)!.attributionNote;
    expect(note('zim-aws-cost-review')).toMatch(/does not claim Alex implemented every infrastructure change/);
    expect(note('zim-black-friday')).toMatch(/oversight was a team one/);
    // Alex identified both defects (confirmed 20 Oct 2026), consistently in the story, the profile and the ZIM@SBB record,
    // without claiming all the testing or every correction.
    const sbb = authored.stories.find(({ id }) => id === 'zim-sbb-quality')!;
    expect(note('zim-sbb-quality')).toMatch(/personally identified both translation defects.*don't say who wrote the key-comparison script or made each correction/);
    expect(sbb.result.text).toMatch(/^During pre-release testing, Alex identified two defects/);
    expect(JSON.stringify(published.profile)).toMatch(/Alex identified both during pre-release testing.*don't say who wrote the script or made the fixes/);
    const sbbRecord = published.projects.find(({ id }) => id === 'zim-sbb')!;
    expect(JSON.stringify(sbbRecord)).toMatch(/Alex identified both defects/);
    // What isn't evidenced is stated as such, so it can't be inferred: the script's author, the fixes, and who else tested.
    expect(sbbRecord.undocumented).toEqual(expect.arrayContaining(['Who wrote the key-comparison script and who implemented the fixes for the two translation defects', 'Who else took part in pre-release testing']));
    expect(sbbRecord.responsibilities.find(({ text }) => text.startsWith('Identified both'))?.text).toMatch(/don't say who wrote the key-comparison script or who implemented the fixes/);
    expect(JSON.stringify([sbb, published.profile, sbbRecord])).not.toMatch(/Alex (built|wrote|created) (the|a) (key-comparison )?script|Alex (fixed|corrected) (both|all|every|them)|all (of )?the testing/);
    // The Black Friday oversight stays the team's; the investigation, fix and lesson are Alex's.
    const friday = authored.stories.find(({ id }) => id === 'zim-black-friday')!;
    expect(note('zim-black-friday')).toMatch(/oversight was a team one\. Alex personally investigated and implemented the fix/);
    expect(friday.action.detail).toMatch(/about 30 minutes/);
    expect(friday.reflection?.text).toMatch(/existing customer entitlements/);
    expect(note('zim-sns-migration')).toMatch(/not measured results/);
    expect(authored.stories.find(({ id }) => id === 'zim-multi-tenancy')!.attribution).toBe('collaborative');
    expect(JSON.stringify(authored)).not.toMatch(/Italian, German|German, French|French, Italian/);
  });

  it('reports a story’s basis from its parts', () => {
    const basis = Object.fromEntries(authored.stories.map((story) => [story.id, storyBasis(story)]));
    expect(basis['zim-live-chat']).toBe('documented');
    expect(basis['zim-sql-performance']).toBe('firsthand');
    expect(basis['zim-multi-tenancy']).toBe('mixed');
  });
});

describe('publication', () => {
  it('publishes the approved catalogue: 18 stories, 18 competencies, 7 interests and 10 background items', () => {
    expect(published.preview).toBeUndefined();
    expect(published.evidence.stories).toHaveLength(18);
    expect(published.evidence.competencies).toHaveLength(18);
    expect(published.evidence.interests.personal.length + published.evidence.interests.technical.length).toBe(7);
    expect(published.evidence.background.motivation.map(({ id }) => id)).toEqual(['from-finance', 'citibank', 'five-years', 'next-role', 'leaving-zim', 'long-term-dream']);
    expect(published.evidence.background.workingEnvironment.map(({ id }) => id)).toEqual(['small-teams', 'strengths', 'frustrations', 'first-six-months']);
    expect(JSON.stringify(published)).not.toMatch(/needs-review|"draft"|"private"|"incomplete"/);
    for (const { part, provenance } of published.evidence.stories.flatMap((story) => storyParts(story, 'detailed'))) expect(provenance, part).not.toBe('inferred');
  });

  it('includes drafts only in a preview, marked as such, and never private items', async () => {
    expect(preview.preview).toBe(true);
    expect(preview.evidence.stories).toHaveLength(18);
    const withPrivate = structuredClone(authored);
    withPrivate.stories[0]!.visibility = 'private';
    const raw = await readContent(contentDir);
    const bundle = buildBundle({ ...raw, evidence: { label: 'evidence', data: withPrivate } }, { includeDrafts: true });
    expect(bundle.evidence.stories.map(({ id }) => id)).not.toContain(withPrivate.stories[0]!.id);
  });

  it('a preview bundle still validates, so the app can load it locally', () => {
    expect(createKnowledgeBase(preview).preview).toBe(true);
    expect(createKnowledgeBase(published).preview).toBe(false);
  });
});

// Fixture evidence: one competency, one story, small enough to vary.
const part = (text: string, provenance = 'documented') => ({ text, provenance, sources: ['cv'] });
function evidence(storyOverrides: Record<string, unknown> = {}, competencyOverrides: Record<string, unknown> = {}) {
  return {
    sources: [{ id: 'cv', label: 'CV', kind: 'cv' }],
    stories: [
      {
        id: 'fixed-it', title: 'Fixed it', projects: ['demo'],
        situation: part('Something was slow in production.'), task: part('Make it fast again.'), action: part('Profiled it and fixed the query.'), result: part('It became fast again.'),
        competencies: ['problem-solving'], questions: [], attribution: 'individual', attributionNote: 'Alex did it alone.', status: 'approved', visibility: 'public',
        ...storyOverrides,
      },
    ],
    competencies: [{ id: 'problem-solving', name: 'Problem-solving', group: 'core', description: 'Fixing things.', stories: ['fixed-it'], questions: ['How?'], ...competencyOverrides }],
  };
}
const build = (data: unknown, includeDrafts = false) => buildBundle({ ...content([project()]), evidence: { label: 'content/evidence.json', data } }, { includeDrafts });

describe('publication rules', () => {
  it('publishes a public, approved story and its competency', () => {
    const bundle = build(evidence());
    expect(bundle.evidence.stories.map(({ id }) => id)).toEqual(['fixed-it']);
    expect(bundle.evidence.competencies.map(({ id }) => id)).toEqual(['problem-solving']);
  });

  it.each([
    ['a draft', { visibility: 'draft' }],
    ['a story awaiting review', { status: 'needs-review' }],
    ['an incomplete story', { status: 'incomplete' }],
    ['a private story', { visibility: 'private' }],
  ])('keeps %s out of the public bundle, and drops a competency left with no example', (_, overrides) => {
    const bundle = build(evidence(overrides));
    expect(bundle.evidence.stories).toEqual([]);
    expect(bundle.evidence.competencies).toEqual([]);
  });

  it('refuses to publish a story with an inferred part', () => {
    expect(() => build(evidence({ result: part('It probably saved money.', 'inferred') }))).toThrow(/published but its result is inferred/);
    expect(() => build(evidence({ visibility: 'draft', result: part('It probably saved money.', 'inferred') }))).not.toThrow();
  });

  it.each([
    ['a story claiming a competency that does not list it', evidence({}, { stories: [] , gap: 'none yet' }), /claims competency "problem-solving", which doesn't list it/],
    ['a competency listing an unknown story', evidence({}, { stories: ['fixed-it', 'ghost'] }), /unknown story "ghost"/],
    ['a story citing an unknown competency', evidence({ competencies: ['problem-solving', 'telepathy'] }), /unknown competency "telepathy"/],
    ['a story about an unknown project', evidence({ projects: ['nope'] }), /unknown project "nope"/],
    ['a competency with neither stories nor a gap', { ...evidence(), stories: [], competencies: [{ id: 'problem-solving', name: 'P', group: 'core', description: 'D', stories: [], questions: ['Q?'] }] }, /no stories and no stated evidence gap/],
    ['an undeclared source', evidence({ result: { text: 'Done.', provenance: 'documented', sources: ['rumour'] } }), /unknown source "rumour"/],
  ])('rejects %s', (_, data, message) => {
    expect(() => build(data)).toThrow(message);
  });
});

describe('finding stories', () => {
  const kb = createKnowledgeBase(preview);

  it('by competency, strongest first, by id or name', () => {
    expect(kb.findStories({ competency: 'problem-solving' })[0]?.id).toBe('zim-sql-performance');
    expect(kb.findStories({ competency: 'Problem-solving' })[0]?.id).toBe('zim-sql-performance');
    expect(kb.getCompetency('Conflict resolution')?.id).toBe('conflict-resolution');
  });

  it('by project, keywords, and leaving out stories already told', () => {
    expect(kb.findStories({ project: 'sol' }).map(({ id }) => id)).toEqual(['sol-accessibility']);
    expect(kb.findStories({ query: 'Black Friday' }).map(({ id }) => id)).toContain('zim-black-friday');
    const first = kb.findStories({ competency: 'collaboration' }).map(({ id }) => id);
    const next = kb.findStories({ competency: 'collaboration', exclude: [first[0]!] }).map(({ id }) => id);
    expect(next).toEqual(first.slice(1));
  });

  it('returns nothing for an unknown competency or project, rather than everything', () => {
    expect(kb.findStories({ competency: 'telepathy' })).toEqual([]);
    expect(kb.findStories({ project: 'nope' })).toEqual([]);
  });
});
