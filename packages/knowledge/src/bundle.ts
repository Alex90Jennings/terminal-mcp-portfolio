import type { z } from 'zod';
import { KnowledgeValidationError } from './errors.ts';
import {
  KNOWLEDGE_BUNDLE_VERSION,
  ProfileSchema,
  ProjectSchema,
  SkillsSchema,
  type KnowledgeBundle,
  type PortfolioProject,
  type Source,
} from './schema.ts';

/** Raw content as authored in `content/`, labelled by where it came from so errors can point at the file. */
export interface RawContent {
  profile: LabelledDocument;
  skills: LabelledDocument;
  projects: LabelledDocument[];
}

export interface LabelledDocument {
  label: string;
  data: unknown;
}

/**
 * Validates authored content and produces the public bundle: unverified claims and
 * private projects are removed, and sources nothing cites any more are dropped.
 */
export function buildBundle(content: RawContent): KnowledgeBundle {
  const issues: string[] = [];

  const parse = <T>(schema: z.ZodType<T>, document: LabelledDocument): T | undefined => {
    const result = schema.safeParse(document.data);
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      issues.push(`${document.label}: ${path}: ${issue.message}`);
    }
    return undefined;
  };

  const profile = parse(ProfileSchema, content.profile);
  const skills = parse(SkillsSchema, content.skills);
  const projects = content.projects
    .map((document) => ({ label: document.label, project: parse(ProjectSchema, document) }))
    .filter((entry): entry is { label: string; project: PortfolioProject } => entry.project !== undefined);

  const names = new Map<string, string>();
  for (const { label, project } of projects) {
    for (const name of [project.id, ...project.aliases]) {
      const owner = names.get(name);
      if (owner !== undefined) issues.push(`${label}: "${name}" is already used by ${owner}`);
      names.set(name, label);
    }
  }

  const ids = new Set(projects.map(({ project }) => project.id));
  const checkProjectRefs = (label: string, path: string, refs: readonly string[]): void => {
    for (const ref of refs) {
      if (!ids.has(ref)) issues.push(`${label}: ${path}: unknown project "${ref}"`);
    }
  };
  skills?.skills.forEach((skill, index) => checkProjectRefs(content.skills.label, `skills.${index}.projects`, skill.projects));
  profile?.experience.forEach((role, index) =>
    checkProjectRefs(content.profile.label, `experience.${index}.projects`, role.projects),
  );

  if (issues.length > 0 || profile === undefined || skills === undefined) {
    throw new KnowledgeValidationError(issues);
  }

  const published = projects
    .map(({ project }) => project)
    .filter((project) => project.visibility !== 'private')
    .map((project) => pruneSources(withoutUnverified(project)))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const publishedIds = new Set(published.map((project) => project.id));
  const onlyPublished = (refs: string[]): string[] => refs.filter((ref) => publishedIds.has(ref));

  const publicProfile = pruneSources(withoutUnverified(profile));
  const publicSkills = pruneSources(withoutUnverified(skills));

  return {
    version: KNOWLEDGE_BUNDLE_VERSION,
    profile: {
      ...publicProfile,
      experience: publicProfile.experience.map((role) => ({ ...role, projects: onlyPublished(role.projects) })),
    },
    skills: {
      ...publicSkills,
      skills: publicSkills.skills.map((skill) => ({ ...skill, projects: onlyPublished(skill.projects) })),
    },
    projects: published,
  };
}

/** Recursively drops every array entry whose `status` is `unverified`. */
export function withoutUnverified<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.filter((item) => !isUnverified(item)).map((item) => withoutUnverified(item)) as T;
  }
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, withoutUnverified(child)])) as T;
}

function isUnverified(value: unknown): boolean {
  return value !== null && typeof value === 'object' && (value as { status?: unknown }).status === 'unverified';
}

/** Keeps only the sources still cited by something in the document. */
function pruneSources<T extends { sources: Source[] }>(document: T): T {
  const cited = new Set<string>();
  const collect = (value: unknown, isRoot: boolean): void => {
    if (Array.isArray(value)) {
      value.forEach((item) => collect(item, false));
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'sources' && !isRoot && Array.isArray(child)) {
        child.forEach((id) => typeof id === 'string' && cited.add(id));
      } else {
        collect(child, false);
      }
    }
  };
  collect(document, true);
  return { ...document, sources: document.sources.filter((source) => cited.has(source.id)) };
}
