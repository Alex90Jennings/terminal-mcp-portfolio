import { describe, expect, it } from 'vitest';
import { ProjectSchema } from '../src/schema.ts';
import { project } from './fixtures.ts';

const messages = (data: unknown): string[] => {
  const result = ProjectSchema.safeParse(data);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe('ProjectSchema', () => {
  it('accepts a minimal project and fills empty sections', () => {
    const parsed = ProjectSchema.parse(project());
    expect(parsed.challenges).toEqual([]);
    expect(parsed.architecture).toEqual({ overview: [], diagrams: [] });
    expect(parsed.overview[0]?.status).toBe('verified');
  });

  it('requires every claim to cite a source', () => {
    expect(messages(project({ overview: [{ text: 'No evidence.', sources: [] }] }))).toContain(
      'overview.0.sources: every claim needs at least one source',
    );
  });

  it('rejects citations of undeclared sources', () => {
    expect(messages(project({ lessons: [{ text: 'Learned.', sources: ['blog'] }] }))).toContain(
      'lessons.0.sources.0: unknown source "blog"',
    );
  });

  it('rejects duplicate source ids', () => {
    const cv = { id: 'cv', label: 'CV', kind: 'cv' };
    expect(messages(project({ sources: [cv, cv] }))).toContain('sources.1.id: duplicate source id "cv"');
  });

  it('rejects ids that are not kebab-case', () => {
    expect(messages(project({ id: 'Clash Of Langs' }))[0]).toMatch(/^id: must be lower-kebab-case/);
  });

  it('rejects unknown fields rather than silently ignoring them', () => {
    expect(messages(project({ achievements: ['Invented the internet'] }))).not.toEqual([]);
  });

  it('only accepts https links', () => {
    expect(messages(project({ links: [{ label: 'Site', url: 'http://example.com', kind: 'live' }] }))).not.toEqual([]);
  });
});
