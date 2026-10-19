import type { KnowledgeBase } from './query.ts';
import type { PortfolioProject, Profile, Responsibility, Skill, Source } from './schema.ts';

/*
 * Read-only views over the knowledge base, shared by every consumer (terminal,
 * MCP tools and resources) so selection and attribution rules live in one place.
 */

/** How each responsibility scope is described to readers. */
export const RESPONSIBILITY_SCOPE_LABELS = {
  individual: 'own work',
  collaborative: 'with the team',
  team: 'team effort',
} as const satisfies Record<Responsibility['scope'], string>;

export const PROJECT_CONTEXT_LABELS = {
  employment: 'Professional work',
  personal: 'Personal project',
  client: 'Client work',
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

export interface ExperienceView {
  employment: EmploymentEntry[];
  education: Profile['education'];
  certifications: Profile['certifications'];
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
    certifications: profile.certifications,
    citations: citationsFor(profile.sources, profileContent),
  };
}
