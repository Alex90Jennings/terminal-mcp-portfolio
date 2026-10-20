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
  /** Ids of the project sources behind this passage; empty for names, focus and topics. */
  sources: string[];
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
  sources: string[];
  normalised: string;
  tokens: ReadonlySet<string>;
}

interface IndexedProject {
  project: PortfolioProject;
  passages: IndexedPassage[];
  /** The project's id, display name and aliases, each as its set of terms. */
  names: string[][];
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

/**
 * Added per term when the query names a project outright (its id, display name
 * or an alias), so the project a visitor names ranks first, consistent with
 * alias resolution: "ZIM" means ZIM Connections even though ZIM@SBB's text
 * mentions "ZIM" more often. A longer name earns more, so "ZIM@SBB" (two
 * terms) still outranks the alias "zim" (one).
 */
const NAMED_PROJECT_BONUS = 12;

export function createSearchIndex(projects: readonly PortfolioProject[]): IndexedProject[] {
  return projects.map((project) => ({
    project,
    passages: passagesOf(project),
    names: [project.id, project.name, ...project.aliases].map((name) => [...new Set(tokenise(name))]).filter((terms) => terms.length > 0),
  }));
}

/** Fields that say what a project is: a term found here counts in full, in each. */
const DEFINING_FIELDS = new Set<SearchField>(['name', 'focus', 'topics', 'technologies']);
/** Narrative fields: a term counts in its best two only, so a word repeated across a long write-up doesn't outweigh a project that is about it. */
const NARRATIVE_FIELDS_COUNTED = 2;

/**
 * How much a project's matches count, by the strength of the evidence it is: production work for an employer (on the CV)
 * a little more than personal projects, and this portfolio's own project (the site being searched) as supporting context.
 */
const CONTEXT_WEIGHTS: Record<PortfolioProject['context']['kind'], number> = { employment: 1.25, client: 1, personal: 1, portfolio: 0.6 };

/**
 * Umbrella terms visitors use for more specific wording: "AI" for LLM and retrieval work. A query term scores as its best
 * variant, never the sum, so the umbrella can't outweigh a direct match.
 */
const UMBRELLA_TERMS: Record<string, readonly string[]> = { ai: ['llm', 'rag', 'retrieval'] };

/**
 * Ranks projects by weighted term overlap. Each query term counts in full in each defining field and in its two best
 * narrative fields, at the fields' weights; a whole-phrase match earns a bonus. Scores are scaled by the share of the
 * query's terms the project matches, and weighted by the evidence the
 * project is (CONTEXT_WEIGHTS), and ties go to the curated project order. A project the query names outright ranks first
 * (see NAMED_PROJECT_BONUS).
 */
export function search(index: readonly IndexedProject[], query: string, limit = 5): SearchHit[] {
  const terms = [...new Set(tokenise(query))];
  if (terms.length === 0) return [];
  const phrase = normalise(query);

  const hits: (SearchHit & { order: number })[] = [];
  for (const { project, passages, names } of index) {
    const named = Math.max(0, ...names.filter((name) => name.every((term) => terms.includes(term))).map((name) => name.length));
    const fieldScore = (term: string) => {
      const weights = (Object.keys(FIELD_WEIGHTS) as SearchField[])
        .filter((field) => passages.some((passage) => passage.field === field && passage.tokens.has(term)))
        .map((field) => ({ field, weight: FIELD_WEIGHTS[field] }));
      const defining = weights.filter(({ field }) => DEFINING_FIELDS.has(field)).reduce((sum, { weight }) => sum + weight, 0);
      const narrative = weights
        .filter(({ field }) => !DEFINING_FIELDS.has(field))
        .map(({ weight }) => weight)
        .sort((a, b) => b - a)
        .slice(0, NARRATIVE_FIELDS_COUNTED)
        .reduce((sum, weight) => sum + weight, 0);
      return defining + narrative;
    };
    const termScores = terms.map((term) => Math.max(fieldScore(term), ...(UMBRELLA_TERMS[term] ?? []).map(fieldScore)));
    // Coverage: a project matching every term of the query beats one matching half of it ("native macOS" vs React Native).
    const coverage = termScores.filter((score) => score > 0).length / terms.length;
    let content = termScores.reduce((sum, score) => sum + score, 0);
    const scored: { passage: IndexedPassage; score: number }[] = [];
    for (const passage of passages) {
      const passageTerms = terms.filter((term) => passage.tokens.has(term) || (UMBRELLA_TERMS[term] ?? []).some((variant) => passage.tokens.has(variant))).length;
      if (passageTerms === 0) continue;
      const phraseBonus = terms.length > 1 && passage.normalised.includes(phrase) ? 1 : 0;
      content += phraseBonus * FIELD_WEIGHTS[passage.field];
      scored.push({ passage, score: (passageTerms + phraseBonus) * FIELD_WEIGHTS[passage.field] });
    }

    const score = named * NAMED_PROJECT_BONUS + content * coverage * CONTEXT_WEIGHTS[project.context.kind];
    if (score === 0) continue;
    hits.push({
      projectId: project.id,
      projectName: project.name,
      order: project.order,
      score: Math.round(score * 100) / 100,
      matches: scored
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_MATCHES_PER_HIT)
        .map(({ passage }) => ({ field: passage.field, text: passage.text, sources: passage.sources })),
    });
  }

  return hits
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(({ order: _order, ...hit }) => hit);
}

/**
 * The passages of one project, in the given fields only, that share terms with
 * the query, best first. Used to show what a partial record left out that
 * bears on the question.
 */
export function searchWithin(
  index: readonly IndexedProject[],
  projectId: string,
  query: string,
  fields: readonly SearchField[],
  limit = 4,
): SearchMatch[] {
  const terms = [...new Set(tokenise(query))];
  const entry = index.find(({ project }) => project.id === projectId);
  if (terms.length === 0 || entry === undefined) return [];
  return entry.passages
    .filter((passage) => fields.includes(passage.field))
    .map((passage) => ({ passage, score: terms.filter((term) => passage.tokens.has(term)).length }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ passage }) => ({ field: passage.field, text: passage.text, sources: passage.sources }));
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
  const raw: { field: SearchField; text: string; sources?: string[] }[] = [
    { field: 'name', text: [project.name, ...project.aliases].join(' ') },
    { field: 'focus', text: `${project.focus}. ${project.tagline}` },
    ...[...project.topics, ...project.listingTags].map((text) => ({ field: 'topics' as const, text })),
    ...project.technologies.map(({ name, sources }) => ({ field: 'technologies' as const, text: name, sources })),
    ...project.overview.map(({ text, sources }) => ({ field: 'overview' as const, text, sources })),
    ...project.responsibilities.map(({ text, sources }) => ({ field: 'responsibilities' as const, text, sources })),
    ...project.architecture.overview.map(({ text, sources }) => ({ field: 'architecture' as const, text, sources })),
    ...project.challenges.map((challenge) => ({
      field: 'challenges' as const,
      text: [challenge.title, challenge.problem, ...challenge.approach, challenge.outcome ?? ''].join(' '),
      sources: challenge.sources,
    })),
    ...project.decisions.map((decision) => ({
      field: 'decisions' as const,
      text: [decision.title, decision.decision, decision.rationale].join(' '),
      sources: decision.sources,
    })),
    ...project.lessons.map(({ text, sources }) => ({ field: 'lessons' as const, text, sources })),
    ...project.limitations.map(({ text, sources }) => ({ field: 'limitations' as const, text, sources })),
  ];
  return raw.map(({ field, text, sources = [] }) => ({
    field,
    text,
    sources,
    normalised: normalise(text),
    tokens: new Set(tokenise(text)),
  }));
}
