/*
 * Attribution and grounding, both deterministic: the sources shown under an
 * answer come from the tool results actually used, never from the model's
 * text, and every figure in the answer is checked against those results.
 */

export interface Citation {
  label: string;
  url?: string;
  kind?: string;
}

/** Every `citations` entry anywhere in a tool result, deduplicated by label and URL. */
export function collectCitations(results: readonly unknown[]): Citation[] {
  const found = new Map<string, Citation>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node === null || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      if (key === 'citations' && Array.isArray(child)) {
        for (const item of child) {
          const { label, url, kind } = (item ?? {}) as Record<string, unknown>;
          if (typeof label !== 'string') continue;
          const citation: Citation = { label, ...(typeof url === 'string' && { url }), ...(typeof kind === 'string' && { kind }) };
          found.set(`${label}|${citation.url ?? ''}`, citation);
        }
      } else {
        visit(child);
      }
    }
  };
  results.forEach(visit);
  return [...found.values()];
}

/** The known projects an answer names, in the order they are listed. */
export function projectsMentioned<T extends { id: string; name: string }>(answer: string, projects: readonly T[]): T[] {
  const text = answer.toLowerCase();
  return projects.filter(({ name }) => text.includes(name.toLowerCase()));
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replaces internal project ids that differ from the display name (e.g.
 * "zim-sbb", "clash-of-langs") with that name, so visitors never see them.
 * Ids only match as whole words, never inside another identifier such as a
 * repository name.
 */
export function withDisplayNames(projects: readonly { id: string; name: string }[]): (text: string) => string {
  const internal = projects.filter(({ id, name }) => id.includes('-') && id.toLowerCase() !== name.toLowerCase());
  if (internal.length === 0) return (text) => text;
  const names = new Map(internal.map(({ id, name }) => [id.toLowerCase(), name]));
  const pattern = new RegExp(`(?<![\\w@/.-])(${internal.map(({ id }) => escapeRegExp(id)).join('|')})(?![\\w@/-])`, 'gi');
  return (text) => text.replace(pattern, (match) => names.get(match.toLowerCase()) ?? match);
}

/**
 * Removes Markdown the terminal would show literally: bold markers and heading
 * hashes. The prompt asks for plain text; this guarantees it for the two forms
 * models most often slip into. Single asterisks and underscores are left alone.
 */
export function toPlainText(text: string): string {
  return text.replace(/\*\*/g, '').replace(/(^|\n)#{1,6} +/g, '$1');
}

export interface GroundingReport {
  /** Figures in the answer, as written, that appear in none of the evidence. */
  unsupportedFigures: string[];
}

/** A number, optionally with thousands separators, a decimal part and a percent sign. */
const FIGURE = /(?<![\d.,])\d[\d,]*(?:\.\d+)?(?:\s?%)?/g;

/** "2,623" → "2623"; "99.9 %" → "99.9%". */
const normaliseFigure = (figure: string) => figure.replace(/,/g, '').replace(/\s+%/, '%').replace(/[.,]$/, '');

/** Every figure in the evidence, as whole numbers: "50,000+" yields "50000", never "50". */
function evidenceFigures(evidence: readonly string[]): Set<string> {
  const figures = new Set<string>();
  for (const text of evidence) {
    for (const match of text.matchAll(FIGURE)) {
      const figure = normaliseFigure(match[0]);
      figures.add(figure);
      // A bare number is supported by its percentage ("99.9" by "99.9%"), but not the reverse.
      if (figure.endsWith('%')) figures.add(figure.slice(0, -1));
    }
  }
  return figures;
}

/**
 * Every figure the answer states (a number of two or more digits, a decimal or
 * a percentage) must appear, as a whole number, in the evidence. Single digits
 * are skipped: they are mostly list counts and ordinals.
 *
 * This checks numbers, not facts: a sentence with no figures, a figure attached
 * to the wrong fact, or a number written in words all pass.
 */
export function checkGrounding(answer: string, evidence: readonly string[]): GroundingReport {
  const known = evidenceFigures(evidence);
  const unsupported = new Set<string>();
  for (const match of answer.matchAll(FIGURE)) {
    const written = match[0].trim().replace(/[.,]$/, '');
    const figure = normaliseFigure(written);
    const isSignificant = figure.includes('%') || figure.includes('.') || figure.replace(/\D/g, '').length >= 2;
    if (isSignificant && !known.has(figure)) unsupported.add(written);
  }
  return { unsupportedFigures: [...unsupported] };
}
