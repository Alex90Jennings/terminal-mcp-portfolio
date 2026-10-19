import { describe, expect, it } from 'vitest';
import { buildBundle, KnowledgeValidationError } from '../src/bundle.ts';
import { content, profile, project, skills } from './fixtures.ts';

const issuesOf = (run: () => unknown): readonly string[] => {
  try {
    run();
  } catch (error) {
    if (error instanceof KnowledgeValidationError) return error.issues;
    throw error;
  }
  return [];
};

describe('buildBundle', () => {
  it('withholds unverified claims everywhere in the document', () => {
    const bundle = buildBundle(
      content([
        project({
          overview: [
            { text: 'Verified.', sources: ['cv'] },
            { text: 'A guess.', sources: ['cv'], status: 'unverified' },
          ],
          decisions: [
            { title: 'Maybe', decision: 'x', rationale: 'y', sources: ['cv'], status: 'unverified' },
          ],
        }),
      ]),
    );
    const [published] = bundle.projects;
    expect(published?.overview.map(({ text }) => text)).toEqual(['Verified.']);
    expect(published?.decisions).toEqual([]);
    expect(JSON.stringify(bundle)).not.toContain('unverified');
  });

  it('never publishes private projects, and unlinks skills from them', () => {
    const bundle = buildBundle(
      content([project(), project({ id: 'secret', name: 'Secret', visibility: 'private' })], {
        skills: { label: 'skills.json', data: skills({ skills: [
          { id: 'go', name: 'Go', category: 'language', projects: ['demo', 'secret'], sources: ['cv'] },
        ] }) },
      }),
    );
    expect(bundle.projects.map(({ id }) => id)).toEqual(['demo']);
    expect(bundle.skills.skills[0]?.projects).toEqual(['demo']);
  });

  it('drops sources that only unverified claims cited', () => {
    const bundle = buildBundle(
      content([
        project({
          sources: [
            { id: 'cv', label: 'CV', kind: 'cv' },
            { id: 'rumour', label: 'Rumour', kind: 'author-statement' },
          ],
          lessons: [{ text: 'Hearsay.', sources: ['rumour'], status: 'unverified' }],
        }),
      ]),
    );
    expect(bundle.projects[0]?.sources.map(({ id }) => id)).toEqual(['cv']);
  });

  it('sorts projects by display order', () => {
    const bundle = buildBundle(content([project({ id: 'b', name: 'B', order: 2 }), project({ id: 'a', name: 'A', order: 1 })], {
      skills: { label: 'skills.json', data: skills({ skills: [{ id: 'x', name: 'X', category: 'language', sources: ['cv'] }] }) },
    }));
    expect(bundle.projects.map(({ id }) => id)).toEqual(['a', 'b']);
  });

  it('reports every problem at once, labelled by file', () => {
    const issues = issuesOf(() =>
      buildBundle(
        content([project(), project({ id: 'broken', tagline: '' }), project({ id: 'other', aliases: ['demo'] })]),
      ),
    );
    expect(issues).toEqual([
      'projects/1.json: tagline: Too small: expected string to have >=1 characters',
      'projects/2.json: "demo" is already used by projects/0.json',
    ]);
  });

  it('rejects references to projects that do not exist', () => {
    const issues = issuesOf(() =>
      buildBundle(
        content([project()], {
          profile: {
            label: 'profile.json',
            data: profile({ experience: [{ organisation: 'X', role: 'Dev', period: '2024', projects: ['ghost'], sources: ['cv'] }] }),
          },
        }),
      ),
    );
    expect(issues).toEqual(['profile.json: experience.0.projects: unknown project "ghost"']);
  });
});
