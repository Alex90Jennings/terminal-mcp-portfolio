import { checkGrounding } from './evidence.ts';

/** Text longer than this is released at the last word boundary even without a sentence end. */
export const MAX_HELD_CHARS = 280;

/** A sentence ends at ., ! or ? (optionally followed by a closing quote or bracket) before whitespace, or at a line break. */
const BOUNDARY = /[.!?]["')\]]?(?=\s)\s*|\n+/g;

export interface Withheld {
  text: string;
  figures: string[];
}

/**
 * Releases streamed text one sentence at a time, and only when every figure
 * in the sentence appears in the evidence gathered so far. A sentence that
 * fails is withheld entirely: it is never shown, signed into the conversation
 * or counted as part of the answer.
 *
 * This is a figure check, not a fact check: a sentence with no figures, or a
 * paraphrase that gets the facts wrong without numbers, passes.
 */
export class SentenceGate {
  private held = '';
  private released = '';
  readonly withheld: Withheld[] = [];

  constructor(
    private readonly evidence: () => readonly string[],
    private readonly emit: (text: string) => void,
    /** Applied to each sentence after it passes the figure check, e.g. to replace internal ids. */
    private readonly present: (text: string) => string = (text) => text,
  ) {}

  push(delta: string): void {
    this.held += delta;
    let end = 0;
    for (const match of this.held.matchAll(BOUNDARY)) end = (match.index ?? 0) + match[0].length;
    if (end === 0 && this.held.length > MAX_HELD_CHARS) {
      // A long run with no sentence end: release up to the last space, never splitting a figure.
      end = this.held.lastIndexOf(' ') + 1;
    }
    if (end > 0) {
      const ready = this.held.slice(0, end);
      this.held = this.held.slice(end);
      this.releaseSentences(ready);
    }
  }

  /** Releases whatever is held, e.g. at the end of a model call. */
  flush(): void {
    const rest = this.held;
    this.held = '';
    if (rest !== '') this.releaseSentences(rest);
  }

  /** Everything released so far: the answer as the visitor saw it. */
  get text(): string {
    return this.released;
  }

  private releaseSentences(text: string): void {
    let start = 0;
    const pieces: string[] = [];
    for (const match of text.matchAll(BOUNDARY)) {
      const end = (match.index ?? 0) + match[0].length;
      pieces.push(text.slice(start, end));
      start = end;
    }
    if (start < text.length) pieces.push(text.slice(start));
    for (const piece of pieces) this.check(piece);
  }

  private check(sentence: string): void {
    if (sentence.trim() === '') {
      this.release(sentence);
      return;
    }
    const { unsupportedFigures } = checkGrounding(sentence, this.evidence());
    if (unsupportedFigures.length > 0) {
      this.withheld.push({ text: sentence.trim(), figures: unsupportedFigures });
      return;
    }
    this.release(sentence);
  }

  private release(raw: string): void {
    const text = this.present(raw);
    this.released += text;
    this.emit(text);
  }
}
