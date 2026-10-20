import { describe, expect, it } from 'vitest';
import { buildBundle } from '../src/bundle.ts';
import { createKnowledgeBase } from '../src/knowledge-base.ts';
import { content, project, skills } from './fixtures.ts';

const kb = createKnowledgeBase(
  buildBundle(
    content(
      [
        project({ id: 'clash-of-langs', name: 'Clash of Langs', aliases: ['clash'], order: 1, focus: 'Benchmarking',
          technologies: [{ name: 'Docker', category: 'devops', sources: ['cv'] }] }),
        project({ id: 'zim-sbb', name: 'ZIM@SBB', aliases: ['sbb'], order: 2, focus: 'White-label apps',
          overview: [{ text: 'Four languages with i18next and Locize.', sources: ['cv'] }] }),
      ],
      { skills: { label: 'skills.json', data: skills({ skills: [{ id: 'docker', name: 'Docker', category: 'devops', projects: ['clash-of-langs'], sources: ['cv'] }] }) } },
    ),
  ),
);

describe('project lookup', () => {
  it.each([
    ['clash-of-langs', 'clash-of-langs'],
    ['clash', 'clash-of-langs'],
    ['Clash of Langs', 'clash-of-langs'],
    ['  CLASH  ', 'clash-of-langs'],
    ['ZIM@SBB', 'zim-sbb'],
    ['2', 'zim-sbb'],
  ])('resolves %j to %s', (input, expected) => {
    expect(kb.resolveProjectId(input)).toBe(expected);
  });

  it.each(['', 'nope', '0', '3', 'clash-of'])('returns undefined for %j', (input) => {
    expect(kb.getProject(input)).toBeUndefined();
  });

  it('suggests the closest project for a typo', () => {
    expect(kb.suggestProjectIds('clsh-of-lang')).toEqual(['clash-of-langs']);
    expect(kb.suggestProjectIds('zim-sb')).toEqual(['zim-sbb']);
    expect(kb.suggestProjectIds('kubernetes')).toEqual([]);
  });
});

describe('search', () => {
  it('ranks the project that uses a technology first', () => {
    expect(kb.search('Which project best demonstrates Docker?')[0]?.projectId).toBe('clash-of-langs');
  });

  it('returns the passages that matched', () => {
    const [hit] = kb.search('localisation with i18next');
    expect(hit?.projectId).toBe('zim-sbb');
    expect(hit?.matches).toContainEqual({ field: 'overview', text: 'Four languages with i18next and Locize.', sources: ['cv'] });
  });

  it('ranks a project the query names by its alias first, even if another project mentions the term more', () => {
    const named = createKnowledgeBase(
      buildBundle(
        content([
          project({ id: 'zim-connections', name: 'ZIM Connections', aliases: ['zim'], order: 1, focus: 'The platform',
            overview: [{ text: 'The platform grew to 50,000 users.', sources: ['cv'] }] }),
          project({ id: 'zim-sbb', name: 'ZIM@SBB', aliases: ['sbb'], order: 2, focus: 'A white-label ZIM app',
            overview: [{ text: 'A build of the ZIM eSIM app on the ZIM platform.', sources: ['cv'] }] }),
        ], { skills: { label: 'skills.json', data: skills({ skills: [{ id: 'react-native', name: 'React Native', category: 'mobile', projects: ['zim-sbb'], sources: ['cv'] }] }) } }),
      ),
    );
    expect(named.search('ZIM').map(({ projectId }) => projectId)).toEqual(['zim-connections', 'zim-sbb']);
    expect(named.search('ZIM users')[0]?.projectId).toBe('zim-connections');
    // The longer, more specific name wins when both are named.
    expect(named.search('ZIM@SBB')[0]?.projectId).toBe('zim-sbb');
    expect(named.search('SBB')[0]?.projectId).toBe('zim-sbb');
    expect(named.resolveProjectId('ZIM')).toBe('zim-connections');
  });

  it('ignores queries made only of stop words', () => {
    expect(kb.search('what is the')).toEqual([]);
  });
});

describe('createKnowledgeBase', () => {
  it('refuses a bundle that still contains unverified claims', () => {
    const bundle = buildBundle(content());
    const tampered = structuredClone(bundle);
    tampered.projects[0]?.overview.push({ text: 'Sneaky.', sources: ['cv'], status: 'unverified' });
    expect(() => createKnowledgeBase(tampered)).toThrow(/unverified/);
  });

  it('rejects malformed bundles', () => {
    expect(() => createKnowledgeBase({ version: 1 })).toThrow(/Knowledge base is invalid/);
  });

  it('is read-only', () => {
    expect(() => (kb.projects as unknown[]).push({})).toThrow(TypeError);
  });
});
