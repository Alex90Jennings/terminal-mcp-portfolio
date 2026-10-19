import type { RawContent } from '../src/bundle.ts';

const cv = { id: 'cv', label: 'CV', kind: 'cv' };

export function project(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'demo',
    name: 'Demo Project',
    order: 1,
    focus: 'Testing',
    tagline: 'A project used in tests.',
    listingTags: ['TypeScript'],
    context: { kind: 'personal' },
    visibility: 'public',
    sources: [cv],
    overview: [{ text: 'Built with care.', sources: ['cv'] }],
    ...overrides,
  };
}

export function profile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Test Person',
    title: 'Software Developer',
    location: 'London, UK',
    bannerSkills: ['TypeScript'],
    sources: [cv],
    summary: [{ text: 'Writes software.', sources: ['cv'] }],
    contact: { email: 'test@example.com' },
    ...overrides,
  };
}

export function skills(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sources: [cv],
    skills: [{ id: 'typescript', name: 'TypeScript', category: 'language', projects: ['demo'], sources: ['cv'] }],
    ...overrides,
  };
}

export function content(projects: Record<string, unknown>[] = [project()], extra: Partial<RawContent> = {}): RawContent {
  return {
    profile: { label: 'profile.json', data: profile() },
    skills: { label: 'skills.json', data: skills() },
    projects: projects.map((data, index) => ({ label: `projects/${index}.json`, data })),
    ...extra,
  };
}
