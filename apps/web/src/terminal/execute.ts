import { askOrFallback } from './ask';
import { formatProject } from './format-project';
import { command, joined, paragraph, text, type Block, type CommandResult } from './output';
import { parseInput } from './parse';
import type { Registry } from './registry';
import type { CommandContext } from './types';

const QUESTION_WORDS = new Set([
  'what', 'which', 'how', 'why', 'who', 'where', 'when', 'tell', 'explain', 'describe', 'show',
  'can', 'could', 'do', 'does', 'did', 'is', 'are', 'have', 'has', 'should', 'would', 'give', 'list',
]);

/** Plain English rather than a command: ends in "?", opens with a question word, or is a longer sentence. */
export function looksLikeQuestion(input: string): boolean {
  const words = input.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (first === undefined) return false;
  return input.trim().endsWith('?') || QUESTION_WORDS.has(first) || words.length >= 4;
}

/**
 * Runs one line of input. Commands are looked up in a fixed registry and
 * receive their arguments as plain strings: nothing is ever evaluated.
 */
export function execute(input: string, registry: Registry, context: CommandContext): CommandResult {
  const { name, args, raw } = parseInput(input);
  if (name === '') return { blocks: [] };

  const found = registry.find(name);
  if (found !== undefined) {
    try {
      return found.run(args, context);
    } catch {
      return { blocks: [paragraph(`Something went wrong running "${found.name}". Please try again.`, 'error')] };
    }
  }

  // A project number or name on its own opens that project.
  const project = context.kb.getProject(raw);
  if (project !== undefined) return { blocks: formatProject(project, 'overview') };

  if (looksLikeQuestion(raw)) return askOrFallback(raw, context);
  return notFound(name, registry, context);
}

function notFound(name: string, registry: Registry, context: CommandContext): CommandResult {
  const commandMatches = registry.suggest(name);
  const projectMatches = context.kb.suggestProjectIds(name, 1);
  const suggestions = [
    ...commandMatches.map((match) => command(match)),
    ...projectMatches.map((id) => command(`projects ${id}`)),
  ];
  const blocks: Block[] = [paragraph(`command not found: ${name}`, 'error')];
  if (suggestions.length > 0) {
    blocks.push(paragraph([text('Did you mean ', 'muted'), ...joined(suggestions, ' or '), text('?', 'muted')]));
  } else {
    const mentions = context.kb.search(name, 3);
    if (mentions.length > 0) {
      blocks.push(
        paragraph([
          text(`"${name}" appears in `, 'muted'),
          ...joined(mentions.map((hit) => command(hit.projectName, `projects ${hit.projectId}`)), ', '),
          text('.', 'muted'),
        ]),
      );
    }
  }
  blocks.push(
    paragraph([
      text('Type ', 'muted'),
      command('help'),
      text(' for the list of commands, or ask a question in plain English.', 'muted'),
    ]),
  );
  return { blocks };
}
