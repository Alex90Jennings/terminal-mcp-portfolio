import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createKnowledgeBase } from '../src/knowledge-base.ts';
import { loadBundle } from '../src/load.ts';
import { citationsFor, citedSourceIds, experienceOf, PROJECT_DATA_SECTIONS, selectProjectSections } from '../src/views.ts';

const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../content');
const kb = createKnowledgeBase(await loadBundle(contentDir));
const sol = kb.getProject('sol');
if (sol === undefined) throw new Error('SOL missing from content');

describe('selectProjectSections', () => {
  it('returns every section by default', () => {
    expect(Object.keys(selectProjectSections(sol))).toEqual(expect.arrayContaining([...PROJECT_DATA_SECTIONS]));
  });

  it('returns only the identifying fields plus the requested sections', () => {
    const selection = selectProjectSections(sol, ['decisions', 'architecture']);
    expect(Object.keys(selection)).toEqual([
      'id', 'name', 'aliases', 'focus', 'tagline', 'listingTags', 'context', 'visibility', 'topics', 'architecture', 'decisions',
    ]);
    expect(selection.decisions).toBe(sol.decisions);
  });
});

describe('citations', () => {
  it('collects every source id cited inside content, but not source objects', () => {
    expect(citedSourceIds(sol.decisions).sort()).toEqual(['accessibility-audit', 'author', 'readme']);
    expect(citedSourceIds({ sources: [{ id: 'x' }] })).toEqual([]);
  });

  it('resolves cited ids to the project’s source records', () => {
    const citations = citationsFor(sol.sources, sol.decisions);
    expect(citations.map(({ id }) => id).sort()).toEqual(['accessibility-audit', 'author', 'readme']);
    expect(citations.find(({ id }) => id === 'author')?.label).toBe('Alex, 19 Oct 2026');
  });
});

describe('experienceOf', () => {
  const experience = experienceOf(kb);

  it('keeps employment, education and certifications as separate sections', () => {
    expect(Object.keys(experience)).toEqual(['employment', 'education', 'certifications', 'citations']);
    expect(experience.education.map(({ institution }) => institution)).toEqual(['QA Ltd.', 'Boolean UK', 'University of Bristol']);
    expect(experience.certifications.map(({ progress }) => progress)).toEqual(['earned', 'earned', 'in-progress']);
  });

  it('draws each role’s responsibilities from its linked projects, attribution intact', () => {
    const [zim] = experience.employment;
    expect(zim?.organisation).toBe('ZIM Connections Ltd.');
    expect(zim?.projects.map(({ id }) => id)).toEqual(['zim-connections', 'zim-sbb']);
    const scopes = new Set(zim?.projects.flatMap(({ responsibilities }) => responsibilities.map(({ scope }) => scope)));
    expect(scopes).toEqual(new Set(['individual', 'collaborative', 'team']));
    expect(zim?.projects[0]?.responsibilities).toBe(kb.getProject('zim-connections')?.responsibilities);
  });

  it('resolves every cited source, per document', () => {
    for (const role of experience.employment) {
      for (const project of role.projects) {
        const known = new Set(project.citations.map(({ id }) => id));
        for (const id of citedSourceIds(project.responsibilities)) expect(known).toContain(id);
      }
    }
    const profileIds = new Set(experience.citations.map(({ id }) => id));
    for (const id of citedSourceIds([experience.education, experience.certifications])) expect(profileIds).toContain(id);
  });
});
