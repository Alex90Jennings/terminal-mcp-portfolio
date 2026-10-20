import type { z } from 'zod';
import { KnowledgeValidationError } from './errors.ts';
import {
  EvidenceSchema,
  KNOWLEDGE_BUNDLE_VERSION,
  ProfileSchema,
  ProjectSchema,
  SkillsSchema,
  type Evidence,
  type Interest,
  type KnowledgeBundle,
  type PortfolioProject,
  type Source,
  type Story,
} from './schema.ts';

/** Raw content as authored in `content/`, labelled by where it came from so errors can point at the file. */
export interface RawContent {
  profile: LabelledDocument;
  skills: LabelledDocument;
  projects: LabelledDocument[];
  /** Stories, competencies, interests and background. Optional: absent means none. */
  evidence?: LabelledDocument;
}

export interface BuildOptions {
  /**
   * Local preview only: also include draft and needs-review evidence (never
   * private), and mark the bundle `preview` so production refuses it.
   */
  includeDrafts?: boolean;
}

const EMPTY_EVIDENCE = { sources: [], stories: [], competencies: [] };

/** Published: public, and approved by Alex. Nothing else leaves the build, except in a local preview. */
export const isPublished = (item: { visibility: string; status: string }): boolean => item.visibility === 'public' && item.status === 'approved';

const STORY_PARTS = ['situation', 'task', 'action', 'result', 'reflection'] as const;

export interface LabelledDocument {
  label: string;
  data: unknown;
}

/**
 * Validates authored content and produces the public bundle: unverified claims and
 * private projects are removed, and sources nothing cites any more are dropped.
 */
export function buildBundle(content: RawContent, options: BuildOptions = {}): KnowledgeBundle {
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
  const evidenceLabel = content.evidence?.label ?? 'content/evidence.json';
  const evidence = parse(EvidenceSchema, content.evidence ?? { label: evidenceLabel, data: EMPTY_EVIDENCE });
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
  if (evidence !== undefined) issues.push(...checkEvidence(evidence, evidenceLabel, checkProjectRefs));

  if (issues.length > 0 || profile === undefined || skills === undefined || evidence === undefined) {
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
    ...(options.includeDrafts && { preview: true as const }),
    evidence: publishEvidence(evidence, publishedIds, options.includeDrafts === true),
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

/**
 * Cross-references and publication rules for evidence: ids are unique; stories
 * and competencies point at each other consistently; projects exist; and a
 * story or interest marked public and approved has every STAR part and nothing
 * inferred, because inferred narrative is never publishable.
 */
function checkEvidence(
  evidence: Evidence,
  label: string,
  checkProjectRefs: (label: string, path: string, refs: readonly string[]) => void,
): string[] {
  const issues: string[] = [];
  const unique = (kind: string, ids: readonly string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) issues.push(`${label}: duplicate ${kind} id "${id}"`);
      seen.add(id);
    }
    return seen;
  };
  const storyIds = unique('story', evidence.stories.map(({ id }) => id));
  const competencyIds = unique('competency', evidence.competencies.map(({ id }) => id));
  const interests = [...evidence.interests.personal, ...evidence.interests.technical, ...evidence.background.motivation, ...evidence.background.workingEnvironment];
  unique('interest', interests.map(({ id }) => id));

  evidence.stories.forEach((story, index) => {
    checkProjectRefs(label, `stories.${index}.projects`, story.projects);
    for (const id of story.competencies) {
      if (!competencyIds.has(id)) issues.push(`${label}: stories.${index}.competencies: unknown competency "${id}"`);
      else if (!evidence.competencies.find((competency) => competency.id === id)?.stories.includes(story.id)) {
        issues.push(`${label}: story "${story.id}" claims competency "${id}", which doesn't list it`);
      }
    }
    if (isPublished(story)) {
      const inferred = STORY_PARTS.filter((part) => story[part]?.provenance === 'inferred');
      if (inferred.length > 0) issues.push(`${label}: story "${story.id}" is published but its ${inferred.join(', ')} is inferred`);
    }
  });
  evidence.competencies.forEach((competency, index) => {
    for (const id of competency.stories) {
      const story = evidence.stories.find((candidate) => candidate.id === id);
      if (!storyIds.has(id) || story === undefined) issues.push(`${label}: competencies.${index}.stories: unknown story "${id}"`);
      else if (!story.competencies.includes(competency.id)) {
        issues.push(`${label}: competency "${competency.id}" lists story "${id}", which doesn't claim it`);
      }
    }
    if (competency.stories.length === 0 && competency.gap === undefined) {
      issues.push(`${label}: competency "${competency.id}" has no stories and no stated evidence gap`);
    }
  });
  interests.forEach((interest) => {
    checkProjectRefs(label, `interest "${interest.id}".projects`, interest.projects);
    if (isPublished(interest) && interest.provenance === 'inferred') issues.push(`${label}: interest "${interest.id}" is published but inferred`);
  });
  return issues;
}

/**
 * The evidence that leaves the build. Published: public and approved stories
 * and interests; competencies that have at least one published story, so a
 * competency is never presented as a strength without an example. A preview
 * also keeps drafts (never private) and every competency.
 */
function publishEvidence(evidence: Evidence, publishedProjects: ReadonlySet<string>, preview: boolean): Evidence {
  const keep = (item: Story | Interest) => (preview ? item.visibility !== 'private' : isPublished(item));
  const stories = evidence.stories.filter(keep).map((story) => ({ ...story, projects: story.projects.filter((id) => publishedProjects.has(id)) }));
  const storyIds = new Set(stories.map(({ id }) => id));
  const competencies = evidence.competencies
    .map((competency) => ({ ...competency, stories: competency.stories.filter((id) => storyIds.has(id)) }))
    .filter((competency) => preview || competency.stories.length > 0);
  const interestsOf = (items: Interest[]) => items.filter(keep).map((item) => ({ ...item, projects: item.projects.filter((id) => publishedProjects.has(id)) }));
  return pruneSources({
    ...evidence,
    stories: stories.map((story) => ({ ...story, competencies: story.competencies.filter((id) => competencies.some((competency) => competency.id === id)) })),
    competencies,
    interests: { personal: interestsOf(evidence.interests.personal), technical: interestsOf(evidence.interests.technical) },
    background: { motivation: interestsOf(evidence.background.motivation), workingEnvironment: interestsOf(evidence.background.workingEnvironment) },
  });
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
