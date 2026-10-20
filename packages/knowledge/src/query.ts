import { KnowledgeValidationError } from './errors.ts';
import type { Competency, Evidence, KnowledgeBundle, PortfolioProject, Profile, Skill, Source, Story } from './schema.ts';
import { createSearchIndex, search, searchWithin, tokenise, type SearchField, type SearchHit, type SearchMatch } from './search.ts';
import { storyPartText, type StarPart } from './views.ts';

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
  /** Passages of one project, in the given fields only, that match the query. */
  searchWithin(projectId: string, query: string, fields: readonly SearchField[], limit?: number): SearchMatch[];
  /** Resolves a project's source ids to their labels and URLs, for citations. */
  citationsFor(project: PortfolioProject, sourceIds: readonly string[]): Source[];
  /** Published evidence: stories, competencies, interests and background. */
  readonly evidence: Evidence;
  /** True for a local preview bundle that includes unpublished drafts. */
  readonly preview: boolean;
  /** A story by id, or a competency by id or name ("problem-solving", "Problem-solving"). */
  getStory(id: string): Story | undefined;
  getCompetency(input: string): Competency | undefined;
  /** The competency a question is about ("How does Alex handle disagreements?" → conflict resolution), from its name and aliases. */
  recogniseCompetency(text: string): Competency | undefined;
  /**
   * Stories matching every given filter, most relevant first. A competency, given or recognised in the query, returns its
   * own stories (ranked by the rest of the query, then strongest first); otherwise the query is a keyword search.
   */
  findStories(filter: StoryFilter): Story[];
  /**
   * The parts (detail included) of the `limit` stories that best match the
   * query, best story first. Project names don't count as matches: every story
   * about a project names it, so they would match everything.
   */
  searchStories(query: string, options?: { project?: string; limit?: number }): StoryPassage[];
}

export interface StoryPassage {
  story: Story;
  part: StarPart | 'reflection';
  text: string;
}

export interface StoryFilter {
  competency?: string;
  project?: string;
  /** Keywords matched against the story's title, parts and interview questions. */
  query?: string;
  /** Story ids to leave out, e.g. ones already told in the conversation. */
  exclude?: readonly string[];
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
  const projectNameTerms = new Set(projects.flatMap((project) => tokenise([project.id, project.name, ...project.aliases].join(' '))));
  // Each competency's name, id and aliases as sets of terms. A question names a competency when it contains every term
  // of one of them; the longest such phrase wins, so "technical decision" beats "decisions". Between equally long
  // phrases, the one the text names first wins: "weakness, a mistake" is about weakness.
  const competencyPhrases = data.evidence.competencies.map((competency) => ({
    competency,
    phrases: [competency.name, competency.id.replace(/-/g, ' '), ...competency.aliases].map((phrase) => [...new Set(tokenise(phrase))]).filter((terms) => terms.length > 0),
  }));
  const recogniseCompetency = (text: string): { competency: Competency; terms: string[] } | undefined => {
    const tokens = tokenise(text);
    const words = new Set(tokens);
    let best: { competency: Competency; terms: string[]; at: number } | undefined;
    for (const { competency, phrases } of competencyPhrases) {
      for (const terms of phrases) {
        if (!terms.every((term) => words.has(term))) continue;
        const at = Math.min(...terms.map((term) => tokens.indexOf(term)));
        if (best === undefined || terms.length > best.terms.length || (terms.length === best.terms.length && at < best.at)) best = { competency, terms, at };
      }
    }
    return best && { competency: best.competency, terms: best.terms };
  };
  const exactCompetency = (input: string) => {
    const key = toKey(input);
    return data.evidence.competencies.find((competency) => competency.id === key || toKey(competency.name) === key);
  };

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
    searchWithin: (projectId, query, fields, limit) => searchWithin(index, projectId, query, fields, limit),
    citationsFor: (project, sourceIds) => project.sources.filter((source) => sourceIds.includes(source.id)),
    evidence: data.evidence,
    preview: data.preview === true,
    getStory: (id) => data.evidence.stories.find((story) => story.id === toKey(id)),
    getCompetency: (input) => exactCompetency(input) ?? recogniseCompetency(input)?.competency,
    recogniseCompetency: (text) => recogniseCompetency(text)?.competency,
    findStories: (filter) => {
      const given = filter.competency === undefined ? undefined : (exactCompetency(filter.competency) ?? recogniseCompetency(filter.competency)?.competency);
      if (filter.competency !== undefined && given === undefined) return [];
      const projectId = filter.project === undefined ? undefined : resolveProjectId(filter.project);
      if (filter.project !== undefined && projectId === undefined) return [];
      const recognised = given === undefined && filter.query !== undefined ? recogniseCompetency(filter.query) : undefined;
      const competency = given ?? recognised?.competency;
      // The rest of the query ranks the stories; words that only name the competency or frame the question don't.
      const terms = [...new Set(tokenise(filter.query ?? ''))].filter((term) => !recognised?.terms.includes(term) && !QUESTION_WORDS.has(term));
      const candidates = (competency ? competency.stories.flatMap((id) => data.evidence.stories.filter((story) => story.id === id)) : data.evidence.stories)
        .filter((story) => projectId === undefined || story.projects.includes(projectId))
        .filter((story) => !filter.exclude?.includes(story.id))
        .map((story, order) => ({ story, order, score: storyScore(story, terms) }));
      // A competency keeps all its stories; a keyword search keeps only the stories that match.
      const kept = competency !== undefined || terms.length === 0 ? candidates : candidates.filter(({ score }) => score > 0);
      return kept.sort((a, b) => b.score - a.score || a.order - b.order).map(({ story }) => story);
    },
    searchStories: (query, { project, limit = 2 } = {}) => {
      const terms = [...new Set(tokenise(query))].filter((term) => !projectNameTerms.has(term));
      const projectId = project === undefined ? undefined : resolveProjectId(project);
      if (terms.length === 0 || (project !== undefined && projectId === undefined)) return [];
      // Stories are ranked as a whole, so a story's result is returned with the situation that matched.
      return data.evidence.stories
        .filter((story) => projectId === undefined || story.projects.includes(projectId))
        .map((story) => {
          const passages = (['situation', 'task', 'action', 'result', 'reflection'] as const).flatMap((part) => {
            const value = story[part];
            if (value === undefined) return [];
            const text = storyPartText(value, 'detailed');
            const words = new Set(tokenise(text));
            const score = terms.filter((term) => words.has(term)).length;
            return score > 0 ? [{ story, part, text, score }] : [];
          });
          return { passages, score: passages.reduce((total, { score }) => total + score, 0) };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .flatMap(({ passages }) => passages.map(({ story, part, text }) => ({ story, part, text })));
    },
  };
}

/** Words that frame a behavioural question rather than say what it's about. */
const QUESTION_WORDS = new Set(tokenise('time describe give example another approach handle handled way good tell made make'));

/** How well a story matches the terms: a match in the title counts most, then the interview questions it answers, then its text. */
function storyScore(story: Story, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const parts = [story.situation, story.task, story.action, story.result, story.reflection].flatMap((part) => (part ? [part.text, part.detail ?? ''] : []));
  const title = new Set(tokenise(story.title));
  const questions = new Set(tokenise(story.questions.join(' ')));
  const text = new Set(tokenise([...parts, ...story.competencies, story.organisation ?? ''].join(' ')));
  return terms.reduce((score, term) => score + (title.has(term) ? 3 : 0) + (questions.has(term) ? 2 : 0) + (text.has(term) ? 1 : 0), 0);
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
