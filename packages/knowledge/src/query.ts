import { KnowledgeValidationError } from './errors.ts';
import type { KnowledgeBundle, PortfolioProject, Profile, Skill, Source } from './schema.ts';
import { createSearchIndex, search, type SearchHit } from './search.ts';

/*
 * Deliberately free of zod: this module ships to the browser. Bundles are
 * validated when `npm run knowledge:build` generates them; `createKnowledgeBase`
 * re-validates for callers that receive a bundle from anywhere else.
 */

export interface KnowledgeBase {
  readonly profile: Profile;
  readonly skills: readonly Skill[];
  /** The sources cited by `skills`. */
  readonly skillSources: readonly Source[];
  /** Published projects, in display order. */
  readonly projects: readonly PortfolioProject[];
  /** Accepts an id, an alias, a display name ("Clash of Langs", "ZIM@SBB") or a 1-based listing number. */
  resolveProjectId(input: string): string | undefined;
  getProject(input: string): PortfolioProject | undefined;
  /** Closest project ids to a mistyped name, best first. */
  suggestProjectIds(input: string, limit?: number): string[];
  search(query: string, limit?: number): SearchHit[];
  /** Resolves a project's source ids to their labels and URLs, for citations. */
  citationsFor(project: PortfolioProject, sourceIds: readonly string[]): Source[];
}

export function wrapKnowledgeBase(bundle: KnowledgeBundle): KnowledgeBase {
  if (JSON.stringify(bundle).includes('"status":"unverified"')) {
    throw new KnowledgeValidationError(['bundle: contains unverified claims; rebuild it with `npm run knowledge:build`']);
  }
  const data = deepFreeze(structuredClone(bundle));

  const projects = data.projects;
  const byKey = new Map<string, PortfolioProject>();
  for (const project of projects) {
    for (const key of [project.id, ...project.aliases, toKey(project.name)]) byKey.set(key, project);
  }
  const index = createSearchIndex(projects);

  const resolveProjectId = (input: string): string | undefined => {
    const trimmed = input.trim();
    if (/^\d+$/.test(trimmed)) return projects[Number(trimmed) - 1]?.id;
    return byKey.get(toKey(trimmed))?.id;
  };

  return {
    profile: data.profile,
    skills: data.skills.skills,
    skillSources: data.skills.sources,
    projects,
    resolveProjectId,
    getProject: (input) => {
      const id = resolveProjectId(input);
      return id === undefined ? undefined : byKey.get(id);
    },
    suggestProjectIds: (input, limit = 2) => {
      const key = toKey(input);
      // Very short or numeric input is within a couple of edits of almost anything.
      if (key.length < 3 || /^\d+$/.test(key)) return [];
      const threshold = Math.max(1, Math.floor(key.length / 3));
      return [...byKey.entries()]
        .map(([candidate, project]) => ({ id: project.id, distance: editDistance(key, candidate) }))
        .filter(({ distance }) => distance <= threshold)
        .sort((a, b) => a.distance - b.distance)
        .map(({ id }) => id)
        .filter((id, position, ids) => ids.indexOf(id) === position)
        .slice(0, limit);
    },
    search: (query, limit) => search(index, query, limit),
    citationsFor: (project, sourceIds) => project.sources.filter((source) => sourceIds.includes(source.id)),
  };
}

/** "ZIM@SBB" → "zim-sbb", "Clash of Langs" → "clash-of-langs". */
function toKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
