import type { Registry } from './registry';
import type { CommandContext } from './types';

export interface Completion {
  /** The new input value, when completion could extend it. */
  value?: string;
  /** Every option that matched, when there was more than one. */
  candidates: string[];
}

/** Shell-style completion of the word at the end of the input. Command names complete to their "/" form. */
export function complete(input: string, registry: Registry, context: CommandContext): Completion {
  const endsWithSpace = /\s$/.test(input);
  const words = input.trimStart().split(/\s+/).filter(Boolean);
  if (endsWithSpace) words.push('');
  if (words.length === 0) return { candidates: [] };

  const partial = (words.length === 1 ? `/${(words[0] ?? '').replace(/^\//, '')}` : (words.at(-1) ?? '')).toLowerCase();
  const options =
    words.length === 1
      ? registry.commands.map(({ name }) => `/${name}`)
      : (registry.find((words[0] ?? '').replace(/^\//, ''))?.complete?.(words.slice(1), context) ?? []);

  const matches = [...new Set(options.filter((option) => option.startsWith(partial)))];
  if (matches.length === 0) return { candidates: [] };

  const prefix = words.slice(0, -1).join(' ');
  const withPrefix = (word: string) => (prefix ? `${prefix} ${word}` : word);
  if (matches.length === 1) return { value: `${withPrefix(matches[0] ?? '')} `, candidates: [] };

  const common = commonPrefix(matches);
  return {
    ...(common.length > partial.length && { value: withPrefix(common) }),
    candidates: matches,
  };
}

function commonPrefix(values: readonly string[]): string {
  const [first = '', ...rest] = values;
  let length = first.length;
  for (const value of rest) {
    while (length > 0 && !value.startsWith(first.slice(0, length))) length--;
  }
  return first.slice(0, length);
}
