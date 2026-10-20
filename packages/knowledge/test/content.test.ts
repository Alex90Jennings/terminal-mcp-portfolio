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
  it('publishes exactly the seven featured projects, in order', () => {
    expect(kb.projects.map(({ id }) => id)).toEqual([
      'zim-connections',
      'zim-sbb',
      'clash-of-langs',
      'operafy',
      'sol',
      'total-guess',
      'terminal-portfolio',
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

describe('search relevance: general principles, no per-question ranking', () => {
  it.each([
    ['TypeScript', 'zim-connections'],
    ['AWS', 'zim-connections'],
    ['backend development', 'zim-connections'],
    ['technical decision-making', 'zim-connections'],
    ['AI', 'total-guess'],
    ['RAG', 'total-guess'],
    ['benchmarking', 'clash-of-langs'],
    ['native macOS', 'sol'],
    ['accessibility', 'sol'],
  ])('"%s" ranks %s first', (query, expected) => {
    expect(kb.search(query)[0]?.projectId).toBe(expected);
  });

  it('this portfolio’s own project doesn’t lead broad searches, but is still found by what only it is about', () => {
    for (const query of ['TypeScript', 'AWS', 'AI', 'backend development', 'technical decision-making']) expect(kb.search(query)[0]?.projectId, query).not.toBe('terminal-portfolio');
    expect(kb.search('MCP')[0]?.projectId).toBe('terminal-portfolio');
    expect(kb.search('Terminal Portfolio')[0]?.projectId).toBe('terminal-portfolio');
  });

  it('keeps exact project names first, and breaks ties by the curated project order', () => {
    expect(kb.search('ZIM@SBB')[0]?.projectId).toBe('zim-sbb');
    expect(kb.search('Operafy')[0]?.projectId).toBe('operafy');
    expect(kb.search('Total Guess')[0]?.projectId).toBe('total-guess');
  });
});
