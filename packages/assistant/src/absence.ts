/*
 * The absence check. A sentence saying the portfolio doesn't record a
 * project's responsibilities, decisions, challenges (or another section) is
 * withheld when that section has content but wasn't retrieved this turn: the
 * model can't know it's missing. It's fail-closed, like the figure check.
 *
 * It is deliberately limited to claims about a whole section. Replayed against
 * 138 recorded answers, it withheld the one such false claim and nothing else.
 * A wider check, matching any topic word against the unseen sections, withheld
 * 10 to 13 correct "not documented" sentences per run, so absence claims about
 * a specific fact are handled instead by retrieval: a partial `get_project`
 * result says what it omitted and carries the omitted passages that match the
 * visitor's question.
 *
 * A project's published examples (STAR stories) count as one more section:
 * "the portfolio has no examples of…" about a project is withheld until
 * get_examples was asked: either it returned every example that matched
 * (`complete`), or it told each of the project's examples.
 *
 * The full records are loaded for verification only: they never become
 * evidence for the figure check and never reach the model.
 */

/** "The portfolio doesn't record…", "it doesn't name…", "…but doesn't mention…", "isn't documented", "no record of". */
export const ABSENCE_CLAIM = new RegExp(
  [
    String.raw`\b(?:the portfolio|it|they|the (?:project['’]s )?(?:record|records|entry|documentation|write-up|notes)|the CV|but)\s+(?:doesn['’]t|does not|don['’]t|do not|didn['’]t|did not)\s+(?:say|mention|record|document|name|include|list|specify|state|give|describe|cover|detail|show)\b`,
    String.raw`\b(?:isn['’]t|is not|aren['’]t|are not|wasn['’]t|was not)\s+(?:documented|recorded|mentioned|covered|listed|specified|named)\b`,
    String.raw`\bno (?:record|mention|documentation)\b`,
    String.raw`\bundocumented\b`,
  ].join('|'),
  'i',
);

/** A sentence about one of these sections can't be supported unless that section was retrieved. */
const SECTION_WORDS: Record<string, RegExp> = {
  responsibilities: /\bresponsibilit/i,
  decisions: /\bdecision/i,
  challenges: /\bchallenge/i,
  architecture: /\barchitectur/i,
  technologies: /\btechnolog/i,
  lessons: /\blesson/i,
  limitations: /\blimitation/i,
  examples: /\b(?:examples?|stor(?:y|ies))\b/i,
};
// What a missing fact would be found in; `undocumented` lists gaps, so it supports an absence claim rather than refuting it.
const FACT_SECTIONS = ['overview', 'technologies', 'responsibilities', 'architecture', 'challenges', 'decisions', 'lessons', 'limitations'] as const;

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value : Array.isArray(value) ? value.map(textOf).join(' ') : typeof value === 'object' && value !== null ? Object.entries(value).filter(([key]) => key !== 'sources' && key !== 'status').map(([, inner]) => textOf(inner)).join(' ') : '';

const hasContent = (value: unknown): boolean => textOf(value).trim() !== '';

export interface AbsenceWithheld {
  text: string;
  /** The project the claim was about, whose unretrieved section has content. */
  project: string;
}

/** What this turn retrieved of each project, checked against the full records. */
export class RetrievalLedger {
  private readonly retrieved = new Map<string, Set<string>>();
  private readonly toldExamples = new Set<string>();
  /** A get_examples call returned everything that matched its filter, so its "none" is an answer. */
  private examplesSearched = false;

  constructor(
    private readonly projects: readonly { id: string; name: string }[],
    /** Each project's full record by id, for verification only. A project missing here isn't checked. */
    private readonly records: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
    /** Each project's published example ids. */
    private readonly examples: ReadonlyMap<string, readonly string[]> = new Map(),
  ) {}

  /** Records one successful `get_project` or `get_examples` result. Anything else is ignored. */
  record(tool: string, structured: unknown): void {
    if (tool === 'get_examples') {
      const { examples: told, complete } = (structured ?? {}) as { examples?: unknown; complete?: unknown };
      if (complete === true) this.examplesSearched = true;
      if (Array.isArray(told)) for (const example of told) if (typeof example?.id === 'string') this.toldExamples.add(example.id);
      return;
    }
    if (tool !== 'get_project') return;
    const result = structured as { project?: { id?: unknown }; sections?: unknown } | undefined;
    const id = result?.project?.id;
    if (typeof id !== 'string' || !Array.isArray(result?.sections)) return;
    const seen = this.retrieved.get(id) ?? new Set<string>();
    for (const section of result.sections) if (typeof section === 'string') seen.add(section);
    this.retrieved.set(id, seen);
  }

  /** Sections with content that no call this turn retrieved; "examples" while any of the project's examples is untold. */
  unseenSections(id: string): string[] {
    const record = this.records.get(id);
    const seen = this.retrieved.get(id) ?? new Set<string>();
    const unseen = record === undefined ? [] : FACT_SECTIONS.filter((section) => !seen.has(section) && hasContent(record[section]));
    const untold = !this.examplesSearched && (this.examples.get(id) ?? []).some((example) => !this.toldExamples.has(example));
    return untold ? [...unseen, 'examples'] : unseen;
  }

  /**
   * The project a claim is about: the first one the sentence names (usually
   * its subject: "ZIM@SBB shares ZIM Connections' backend, but … on it"), else
   * the last one named earlier in the answer ("…but the portfolio doesn't
   * record its decisions").
   */
  private subject(sentence: string, before: string): { id: string; name: string } | undefined {
    const lower = sentence.toLowerCase();
    const first = this.projects
      .flatMap((project) => [project.name, project.id].flatMap((label) => wholeWordIndexes(lower, label.toLowerCase())).map((index) => ({ project, index })))
      .sort((a, b) => a.index - b.index)[0];
    if (first !== undefined) return first.project;
    const earlier = before.toLowerCase();
    let latest: { id: string; name: string } | undefined;
    let at = -1;
    for (const project of this.projects) {
      for (const label of [project.name, project.id]) {
        const index = Math.max(-1, ...wholeWordIndexes(earlier, label.toLowerCase()));
        if (index > at) [latest, at] = [project, index];
      }
    }
    return latest;
  }

  /** Undefined when the sentence may be released; otherwise why it's withheld. */
  check(sentence: string, before: string): AbsenceWithheld | undefined {
    if (!ABSENCE_CLAIM.test(sentence)) return undefined;
    const project = this.subject(sentence, before);
    if (project === undefined) return undefined;
    const unseen = this.unseenSections(project.id);
    return unseen.some((section) => SECTION_WORDS[section]?.test(sentence)) ? { text: sentence.trim(), project: project.name } : undefined;
  }
}

/** Every index where `word` occurs in `text` as a whole word. */
function wholeWordIndexes(text: string, word: string): number[] {
  const found: number[] = [];
  for (let index = text.indexOf(word); index >= 0; index = text.indexOf(word, index + 1)) {
    const before = text[index - 1] ?? ' ';
    const after = text[index + word.length] ?? ' ';
    if (!/[a-z0-9@-]/.test(before) && !/[a-z0-9@-]/.test(after)) found.push(index);
  }
  return found;
}
