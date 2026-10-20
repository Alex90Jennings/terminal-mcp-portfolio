import { kb } from '@/lib/knowledge';
import { execute } from '@/terminal/execute';
import { blocksToText, type Block, type Inline } from '@/terminal/output';
import { registry } from '@/terminal/registry';
import type { CommandContext } from '@/terminal/types';

export const context = (overrides: Partial<CommandContext> = {}): CommandContext => ({
  kb,
  history: [],
  commands: registry.commands,
  aiAvailable: false,
  ...overrides,
});

export const run = (input: string, overrides: Partial<CommandContext> = {}) => execute(input, registry, context(overrides));

export const output = (input: string, overrides: Partial<CommandContext> = {}): string => blocksToText(run(input, overrides).blocks);

/** Every command link in some output, e.g. "projects sol". */
export function commandsIn(blocks: readonly Block[]): string[] {
  const found: string[] = [];
  const visit = (content: readonly Inline[]) => {
    for (const item of content) if (typeof item !== 'string' && 'command' in item) found.push(item.command);
  };
  for (const block of blocks) {
    if (block.kind === 'paragraph') visit(block.content);
    if (block.kind === 'list') block.items.forEach((item) => item.lines.forEach(visit));
    if (block.kind === 'definitions') block.rows.forEach((row) => [row.term, row.detail].forEach(visit));
  }
  return found;
}

/** Every external link in some output. */
export function hrefsIn(blocks: readonly Block[]): string[] {
  return JSON.stringify(blocks).match(/"href":"[^"]+"/g)?.map((match) => match.slice(8, -1)) ?? [];
}
