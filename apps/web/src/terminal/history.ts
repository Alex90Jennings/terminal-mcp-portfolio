export const MAX_HISTORY = 100;

export interface HistoryCursor {
  /** Index into history while browsing, or null when editing a fresh line. */
  index: number | null;
  /** What the user had typed before they started browsing. */
  draft: string;
}

export const idleCursor: HistoryCursor = { index: null, draft: '' };

/** Records a submitted line, skipping blanks and immediate repeats, like most shells. */
export function remember(history: readonly string[], line: string): string[] {
  const entry = line.trim();
  if (entry === '' || history.at(-1) === entry) return [...history];
  return [...history, entry].slice(-MAX_HISTORY);
}

/** Moves through history with ↑ (`-1`) and ↓ (`+1`), returning the new cursor and input value. */
export function browse(
  history: readonly string[],
  cursor: HistoryCursor,
  currentInput: string,
  direction: -1 | 1,
): { cursor: HistoryCursor; value: string } {
  if (history.length === 0) return { cursor, value: currentInput };

  if (cursor.index === null) {
    if (direction === 1) return { cursor, value: currentInput };
    const index = history.length - 1;
    return { cursor: { index, draft: currentInput }, value: history[index] ?? '' };
  }

  const index = cursor.index + direction;
  if (index < 0) return { cursor, value: history[0] ?? '' };
  if (index >= history.length) return { cursor: idleCursor, value: cursor.draft };
  return { cursor: { ...cursor, index }, value: history[index] ?? '' };
}
