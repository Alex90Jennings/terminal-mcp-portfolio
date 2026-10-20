import type { KnowledgeBase } from './query.ts';
import type { Competency, PortfolioProject, Profile, Provenance, Responsibility, Skill, Source, Story, StoryPart } from './schema.ts';

/*
 * Read-only views over the knowledge base, shared by every consumer (terminal,
 * MCP tools and resources) so selection and attribution rules live in one place.
 */

/** How each responsibility scope is described to readers. */
export const RESPONSIBILITY_SCOPE_LABELS = {
  individual: 'own work',
  collaborative: 'collaborative',
  team: 'team effort',
} as const satisfies Record<Responsibility['scope'], string>;

export const PROJECT_CONTEXT_LABELS = {
  employment: 'Professional work',
  personal: 'Personal project',
  client: 'Client work',
  portfolio: 'Personal project: this portfolio',
} as const satisfies Record<PortfolioProject['context']['kind'], string>;

export const SKILL_CATEGORY_LABELS = {
  language: 'Languages',
  frontend: 'Frontend',
  mobile: 'Mobile & native',
  backend: 'Backend',
  data: 'Data',
  cloud: 'Cloud',
  devops: 'DevOps',
  ai: 'AI',
  quality: 'Quality',
  practice: 'Practice',
} as const satisfies Record<Skill['category'], string>;

/** The parts of a project a client can ask for individually. */
export const PROJECT_DATA_SECTIONS = [
  'overview',
  'technologies',
  'responsibilities',
  'architecture',
  'challenges',
  'decisions',
  'lessons',
  'limitations',
  'links',
  'undocumented',
] as const;

export type ProjectDataSection = (typeof PROJECT_DATA_SECTIONS)[number];

const HEADER_FIELDS = ['id', 'name', 'aliases', 'focus', 'tagline', 'listingTags', 'context', 'visibility', 'topics'] as const;

export type ProjectHeader = Pick<PortfolioProject, (typeof HEADER_FIELDS)[number]>;
export type ProjectSelection = ProjectHeader & Partial<Pick<PortfolioProject, ProjectDataSection>>;

export function projectHeader(project: PortfolioProject): ProjectHeader {
  return Object.fromEntries(HEADER_FIELDS.map((field) => [field, project[field]])) as ProjectHeader;
}

/** The project's identifying fields plus only the requested sections, in canonical order. */
export function selectProjectSections(
  project: PortfolioProject,
  sections: readonly ProjectDataSection[] = PROJECT_DATA_SECTIONS,
): ProjectSelection {
  const selected: ProjectSelection = projectHeader(project);
  for (const section of PROJECT_DATA_SECTIONS) {
    if (sections.includes(section)) Object.assign(selected, { [section]: project[section] });
  }
  return selected;
}

/** Ids of every source cited anywhere inside a value (any nested `sources: string[]`). */
export function citedSourceIds(value: unknown): string[] {
  const ids = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      if (key === 'sources' && Array.isArray(child) && child.every((id) => typeof id === 'string')) {
        child.forEach((id: string) => ids.add(id));
      } else {
        visit(child);
      }
    }
  };
  visit(value);
  return [...ids];
}

/** The sources, from a document's source list, that some content actually cites. */
export function citationsFor(sources: readonly Source[], content: unknown): Source[] {
  const cited = new Set(citedSourceIds(content));
  return sources.filter((source) => cited.has(source.id));
}

export interface ExperienceProject {
  id: string;
  name: string;
  /** As recorded on the project, with individual / collaborative / team attribution intact. */
  responsibilities: Responsibility[];
  /** Resolves the source ids used in `responsibilities` (project sources). */
  citations: Source[];
}

export interface EmploymentEntry {
  organisation: string;
  role: string;
  period: string;
  location?: string;
  sources: string[];
  projects: ExperienceProject[];
}

/**
 * Earned certifications and the ones being studied for, kept apart so a count
 * or a list can never turn studying into holding a qualification.
 */
export interface CertificationsView {
  /** Certifications Alex holds. */
  earned: Profile['certifications'];
  /** How many Alex holds: only `earned` counts. */
  earnedCount: number;
  /** Certifications Alex is studying for: not held. */
  inProgress: Profile['certifications'];
}

export interface ExperienceView {
  employment: EmploymentEntry[];
  education: Profile['education'];
  certifications: CertificationsView;
  /** Resolves the source ids used by employment, education and certifications (profile sources). */
  citations: Source[];
}

/** Employment history with each role's responsibilities drawn from its linked projects, plus education and certifications. */
export function experienceOf(kb: KnowledgeBase): ExperienceView {
  const { profile } = kb;
  const employment = profile.experience.map((role): EmploymentEntry => ({
    organisation: role.organisation,
    role: role.role,
    period: role.period,
    ...(role.location !== undefined && { location: role.location }),
    sources: role.sources,
    projects: role.projects.flatMap((id) => {
      const project = kb.getProject(id);
      if (project === undefined) return [];
      return [
        {
          id: project.id,
          name: project.name,
          responsibilities: project.responsibilities,
          citations: citationsFor(project.sources, project.responsibilities),
        },
      ];
    }),
  }));

  const profileContent = [profile.experience, profile.education, profile.certifications];
  return {
    employment,
    education: profile.education,
    certifications: certificationsOf(profile.certifications),
    citations: citationsFor(profile.sources, profileContent),
  };
}

export function certificationsOf(certifications: Profile['certifications']): CertificationsView {
  const earned = certifications.filter(({ progress }) => progress === 'earned');
  return { earned, earnedCount: earned.length, inProgress: certifications.filter(({ progress }) => progress !== 'earned') };
}

/**
 * What a project shows about Alex: its published STAR stories, the soft skills those stories demonstrate (most often
 * shown first), and the technical skills linked to it. All from existing links; nothing is inferred.
 */
export function projectEvidence(kb: KnowledgeBase, projectId: string): { stories: Story[]; competencies: Competency[]; skills: Skill[] } {
  const stories = kb.findStories({ project: projectId });
  const counts = new Map<string, number>();
  for (const story of stories) for (const id of story.competencies) counts.set(id, (counts.get(id) ?? 0) + 1);
  const competencies = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .flatMap(([id]) => {
      const competency = kb.getCompetency(id);
      return competency ? [competency] : [];
    });
  return { stories, competencies, skills: kb.skills.filter((skill) => skill.projects.includes(projectId)) };
}

/** How each story attribution is described to readers. */
export const STORY_ATTRIBUTION_LABELS = {
  individual: "Alex's own work",
  collaborative: 'Alex with others',
  team: 'A team result Alex contributed to',
} as const satisfies Record<Story['attribution'], string>;

/** What a reader is told about where a part of a story comes from. Inferred parts are never published. */
export const PROVENANCE_LABELS = {
  documented: 'project records',
  firsthand: "Alex's own account",
  inferred: 'drafted, unconfirmed',
} as const satisfies Record<Provenance, string>;

export const COMPETENCY_GROUP_LABELS = {
  core: 'Soft skills',
  mindset: 'Engineering & product mindset',
} as const satisfies Record<Competency['group'], string>;

export const STAR_PARTS = ['situation', 'task', 'action', 'result'] as const;
export type StarPart = (typeof STAR_PARTS)[number];

/** One part of a story, short (`text`) or detailed (`text` and `detail`). Both come from the same facts. */
export function storyPartText(part: StoryPart, version: 'short' | 'detailed'): string {
  return version === 'detailed' && part.detail !== undefined ? `${part.text} ${part.detail}` : part.text;
}

/** A story's four parts (and reflection, in the detailed version), in order. */
export function storyParts(story: Story, version: 'short' | 'detailed'): { part: StarPart | 'reflection'; text: string; provenance: Provenance }[] {
  const parts = STAR_PARTS.map((part) => ({ part, text: storyPartText(story[part], version), provenance: story[part].provenance }));
  return version === 'detailed' && story.reflection
    ? [...parts, { part: 'reflection' as const, text: storyPartText(story.reflection, version), provenance: story.reflection.provenance }]
    : parts;
}

/** The whole story as prose, e.g. for word counts and the review document. */
export function storyText(story: Story, version: 'short' | 'detailed'): string {
  return storyParts(story, version).map(({ text }) => text).join(' ');
}

/** Whether a story rests on project records, Alex's own account, or both. */
export function storyBasis(story: Story): 'documented' | 'firsthand' | 'mixed' {
  const kinds = new Set(storyParts(story, 'detailed').map(({ provenance }) => provenance));
  return kinds.size === 1 && kinds.has('documented') ? 'documented' : kinds.has('documented') ? 'mixed' : 'firsthand';
}
