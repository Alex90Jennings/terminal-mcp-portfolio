import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createKnowledgeBase } from '../src/knowledge-base.ts';
import { loadBundle } from '../src/load.ts';

/** The real content in `content/` must always build. */
const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../content');
const bundle = await loadBundle(contentDir);
const kb = createKnowledgeBase(bundle);

describe('portfolio content', () => {
  it('publishes exactly the six featured projects, in order', () => {
    expect(kb.projects.map(({ id }) => id)).toEqual([
      'zim-connections',
      'zim-sbb',
      'clash-of-langs',
      'operafy',
      'sol',
      'total-guess',
    ]);
  });

  it('gives every project an overview and technologies', () => {
    for (const project of kb.projects) {
      expect(project.overview.length, project.id).toBeGreaterThan(0);
      expect(project.technologies.length, project.id).toBeGreaterThan(0);
    }
  });

  it('distinguishes individual from team work on employer projects', () => {
    const zim = kb.getProject('zim');
    expect(zim?.responsibilities.some(({ scope }) => scope === 'team')).toBe(true);
    expect(zim?.visibility).toBe('professional');
  });

  it.each([
    ['What is your experience with AWS?', 'zim-connections'],
    ['Which project best demonstrates Docker?', 'clash-of-langs'],
    ['What did you use Terraform for?', 'operafy'],
    ['How did you approach accessibility in SOL?', 'sol'],
    ['retrieval augmented generation', 'total-guess'],
    ['multi-tenancy and localisation', 'zim-sbb'],
  ])('search for %j finds %s first', (query, expected) => {
    expect(kb.search(query)[0]?.projectId).toBe(expected);
  });

  it('never publishes the phone number or private source material', () => {
    const text = JSON.stringify(bundle);
    expect(text).not.toMatch(/\+?44\s?7\d{3}|07\d{3}\s?\d{6}/);
    expect(text).not.toMatch(/\.env|tfstate|\.captures/);
  });
});
