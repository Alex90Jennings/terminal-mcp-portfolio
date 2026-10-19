export const MAX_INPUT_LENGTH = 500;

export interface ParsedInput {
  /** The command name, lower-cased. Empty for blank input. */
  name: string;
  args: string[];
  /** The trimmed input as typed. */
  raw: string;
}

/**
 * Splits input into a command and arguments. Quotes group words
 * (`projects "clash of langs"`); nothing is ever evaluated.
 */
export function parseInput(input: string): ParsedInput {
  const raw = input.slice(0, MAX_INPUT_LENGTH).trim();
  const tokens: string[] = [];
  for (const match of raw.matchAll(/"([^"]*)"?|'([^']*)'?|(\S+)/g)) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  const [name = '', ...args] = tokens;
  return { name: name.toLowerCase(), args, raw };
}
