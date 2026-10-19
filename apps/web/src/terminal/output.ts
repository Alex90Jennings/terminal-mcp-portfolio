/**
 * What commands return. Output is structured rather than a string, so the
 * renderer decides semantics (lists, headings, links) and commands stay
 * framework-free and testable.
 */

export type Tone = 'default' | 'muted' | 'accent' | 'error';

export type Inline =
  | string
  | { text: string; tone?: Tone; strong?: boolean }
  /** An external link. Rendered as an anchor that opens in a new tab. */
  | { text: string; href: string }
  /** Runs a terminal command when activated, e.g. a project name in a listing. */
  | { text: string; command: string };

export interface ListItem {
  /** Shown before the first line, e.g. "[1]". */
  marker?: string;
  lines: Inline[][];
}

export type Block =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'subheading'; text: string }
  | { kind: 'paragraph'; content: Inline[]; tone?: Tone }
  | { kind: 'list'; items: ListItem[]; ordered?: boolean }
  /** Label/value rows, e.g. command names and their descriptions. */
  | { kind: 'definitions'; rows: { term: Inline[]; detail: Inline[] }[] };

export interface CommandResult {
  blocks: Block[];
  /** Clear the screen instead of appending output. */
  clear?: boolean;
  /** Ask the AI assistant; `fallback` is shown instead if it is unavailable. */
  ask?: { question: string; fallback: Block[] };
}

export const text = (value: string, tone?: Tone, strong?: boolean): Inline =>
  tone === undefined && strong === undefined ? value : { text: value, ...(tone && { tone }), ...(strong && { strong }) };

export const link = (label: string, href: string): Inline => ({ text: label, href });

export const command = (label: string, run: string = label): Inline => ({ text: label, command: run });

export const paragraph = (content: Inline | Inline[], tone?: Tone): Block => ({
  kind: 'paragraph',
  content: Array.isArray(content) ? content : [content],
  ...(tone && { tone }),
});

export const heading = (value: string): Block => ({ kind: 'heading', text: value });

export const subheading = (value: string): Block => ({ kind: 'subheading', text: value });

export const bullets = (lines: Inline[][]): Block => ({
  kind: 'list',
  items: lines.map((line) => ({ lines: [line] })),
});

/** Joins inline items with a separator, e.g. technologies with " · ". */
export function joined(items: Inline[], separator = ' · '): Inline[] {
  return items.flatMap((item, index) => (index === 0 ? [item] : [text(separator, 'muted'), item]));
}

/** Plain text of some inline content, for tests and accessible names. */
export function plain(content: readonly Inline[]): string {
  return content.map((item) => (typeof item === 'string' ? item : item.text)).join('');
}

export function blocksToText(blocks: readonly Block[]): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'title':
        case 'heading':
        case 'subheading':
          return block.text;
        case 'paragraph':
          return plain(block.content);
        case 'list':
          return block.items
            .map((item) => item.lines.map((line, index) => `${index === 0 && item.marker ? `${item.marker} ` : ''}${plain(line)}`).join('\n'))
            .join('\n');
        case 'definitions':
          return block.rows.map((row) => `${plain(row.term)}  ${plain(row.detail)}`).join('\n');
      }
    })
    .join('\n');
}
