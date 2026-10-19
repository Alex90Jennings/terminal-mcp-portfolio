import type { PortfolioProject } from './schema.ts';

export type SearchField =
  | 'name'
  | 'focus'
  | 'topics'
  | 'technologies'
  | 'overview'
  | 'responsibilities'
  | 'architecture'
  | 'challenges'
  | 'decisions'
  | 'lessons'
  | 'limitations';

export interface SearchMatch {
  field: SearchField;
  text: string;
}

export interface SearchHit {
  projectId: string;
  projectName: string;
  score: number;
  matches: SearchMatch[];
}

interface IndexedPassage {
  field: SearchField;
  text: string;
  normalised: string;
  tokens: ReadonlySet<string>;
}

interface IndexedProject {
  project: PortfolioProject;
  passages: IndexedPassage[];
}

const FIELD_WEIGHTS: Record<SearchField, number> = {
  name: 6,
  focus: 4,
  topics: 3,
  technologies: 3,
  overview: 2,
  responsibilities: 2,
  architecture: 1.5,
  challenges: 1.5,
  decisions: 1.5,
  lessons: 1,
  limitations: 1,
};

const STOPWORDS = new Set(
  'a an and are as at be by did do does for from has have how i in is it its me my of on or show tell the this to was what which who why with you your about project projects alex experience used use'.split(
    ' ',
  ),
);

const MAX_MATCHES_PER_HIT = 4;

export function createSearchIndex(projects: readonly PortfolioProject[]): IndexedProject[] {
  return projects.map((project) => ({ project, passages: passagesOf(project) }));
}

/**
 * Ranks projects by weighted term overlap. Each query term counts once per
 * field, at the field's weight, and a whole-phrase match earns a bonus.
 */
export function search(index: readonly IndexedProject[], query: string, limit = 5): SearchHit[] {
  const terms = [...new Set(tokenise(query))];
  if (terms.length === 0) return [];
  const phrase = normalise(query);

  const hits: SearchHit[] = [];
  for (const { project, passages } of index) {
    let score = 0;
    const scored: { passage: IndexedPassage; score: number }[] = [];

    for (const field of Object.keys(FIELD_WEIGHTS) as SearchField[]) {
      const inField = passages.filter((passage) => passage.field === field);
      const matched = new Set(terms.filter((term) => inField.some((passage) => passage.tokens.has(term))));
      score += matched.size * FIELD_WEIGHTS[field];

      for (const passage of inField) {
        const passageTerms = terms.filter((term) => passage.tokens.has(term)).length;
        if (passageTerms === 0) continue;
        const phraseBonus = terms.length > 1 && passage.normalised.includes(phrase) ? 1 : 0;
        score += phraseBonus * FIELD_WEIGHTS[field];
        scored.push({ passage, score: (passageTerms + phraseBonus) * FIELD_WEIGHTS[field] });
      }
    }

    if (score === 0) continue;
    hits.push({
      projectId: project.id,
      projectName: project.name,
      score: Math.round(score * 100) / 100,
      matches: scored
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_MATCHES_PER_HIT)
        .map(({ passage }) => ({ field: passage.field, text: passage.text })),
    });
  }

  return hits.sort((a, b) => b.score - a.score || a.projectName.localeCompare(b.projectName)).slice(0, limit);
}

export function tokenise(text: string): string[] {
  return (normalise(text).match(/[\p{L}\p{N}]+[+#]*/gu) ?? [])
    .map(stem)
    .filter((token) => !STOPWORDS.has(token));
}

/** Lower case, no diacritics, and "Node.js" / "Next.js" read as "nodejs" / "nextjs". */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/([\p{L}\p{N}])\.([\p{L}\p{N}])/gu, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function passagesOf(project: PortfolioProject): IndexedPassage[] {
  const raw: { field: SearchField; text: string }[] = [
    { field: 'name', text: [project.name, ...project.aliases].join(' ') },
    { field: 'focus', text: `${project.focus}. ${project.tagline}` },
    ...[...project.topics, ...project.listingTags].map((text) => ({ field: 'topics' as const, text })),
    ...project.technologies.map(({ name }) => ({ field: 'technologies' as const, text: name })),
    ...project.overview.map(({ text }) => ({ field: 'overview' as const, text })),
    ...project.responsibilities.map(({ text }) => ({ field: 'responsibilities' as const, text })),
    ...project.architecture.overview.map(({ text }) => ({ field: 'architecture' as const, text })),
    ...project.challenges.map((challenge) => ({
      field: 'challenges' as const,
      text: [challenge.title, challenge.problem, ...challenge.approach, challenge.outcome ?? ''].join(' '),
    })),
    ...project.decisions.map((decision) => ({
      field: 'decisions' as const,
      text: [decision.title, decision.decision, decision.rationale].join(' '),
    })),
    ...project.lessons.map(({ text }) => ({ field: 'lessons' as const, text })),
    ...project.limitations.map(({ text }) => ({ field: 'limitations' as const, text })),
  ];
  return raw.map(({ field, text }) => ({
    field,
    text,
    normalised: normalise(text),
    tokens: new Set(tokenise(text)),
  }));
}
