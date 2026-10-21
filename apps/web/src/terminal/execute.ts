import { askOrFallback } from './ask';
import { formatProject } from './format-project';
import { command, joined, link, paragraph, text, type Block, type CommandResult } from './output';
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

const CV_WORDS = /\b(cv|resume|résumé|curriculum vitae)\b/i;
const FILE_WORDS = /\b(download|get|copy|send|share|see|view|link|where|access|pdf|have|obtain|request)\b/i;

/** A request for the CV document ("How can I download Alex's CV?"), not a question about what it says. */
export const asksForCv = (input: string): boolean => CV_WORDS.test(input) && FILE_WORDS.test(input);

const SALARY_WORDS = /\b(salary|salaries|compensation|remuneration|wages?|day rate|pay (expectations?|range)|expected pay)\b/i;

/** A question about pay ("What are Alex's salary expectations?"): Alex would rather discuss that directly. */
export const asksAboutSalary = (input: string): boolean => SALARY_WORDS.test(input);

/**
 * Runs one line of input. A line starting with "/" is a command (`/help`, `/projects sol`); anything else is
 * conversation for the AI assistant ("hi", "Why should we hire Alex?"). As a shortcut a bare command name still works
 * (`help`, `projects sol`), as do a project's number or name. Commands are looked up in a fixed registry and receive
 * their arguments as plain strings: nothing is ever evaluated.
 */
export function execute(input: string, registry: Registry, context: CommandContext): CommandResult {
  const { name, args, raw, slash } = parseInput(input);
  if (name === '') return slash ? runCommand('help', [], registry, context) : { blocks: [] };

  const found = registry.find(name);
  if (slash) return found === undefined ? notFound(name, registry, context) : runCommand(found.name, args, registry, context);

  // A bare command name on its own, or one that takes arguments ("projects sol") followed by words that don't read as a
  // sentence: "help me with this" or "experience with React" is conversation.
  if (found !== undefined && (args.length === 0 || (found.usage !== undefined && (found.name === 'ask' || !looksLikeQuestion(raw))))) return runCommand(found.name, args, registry, context);

  // A project number or name on its own opens that project.
  const project = context.kb.getProject(raw);
  if (project !== undefined) return { blocks: formatProject(project, 'overview', context.kb) };

  // Asking for the CV itself gets the `cv` command and its download link, not an AI answer: the CV is never AI knowledge.
  const cv = registry.find('cv');
  if (cv !== undefined && asksForCv(raw)) return cv.run([], context);

  // Pay is for a conversation with Alex, so it gets the contact details rather than an AI answer.
  if (asksAboutSalary(raw)) return salary(registry, context);

  return askOrFallback(raw, context);
}

function runCommand(name: string, args: string[], registry: Registry, context: CommandContext): CommandResult {
  const found = registry.find(name);
  if (found === undefined) return notFound(name, registry, context);
  try {
    return found.run(args, context);
  } catch {
    return { blocks: [paragraph(`Something went wrong running "/${found.name}". Please try again.`, 'error')] };
  }
}

function salary(registry: Registry, context: CommandContext): CommandResult {
  const { phone } = context.kb.profile.contact;
  const intro = paragraph([
    text('Salary is best talked through with Alex directly, so please send Alex a message'),
    ...(phone !== undefined ? [text(', or why not call Alex on '), link(phone, `tel:${phone.replace(/ /g, '')}`), text('?')] : [text('.')]),
  ]);
  return { blocks: [intro, ...(registry.find('contact')?.run([], context).blocks ?? [])] };
}

function notFound(name: string, registry: Registry, context: CommandContext): CommandResult {
  const commandMatches = registry.suggest(name);
  const projectMatches = context.kb.suggestProjectIds(name, 1);
  const suggestions = [
    ...commandMatches.map((match) => command(`/${match}`)),
    ...projectMatches.map((id) => command(`/projects ${id}`)),
  ];
  const blocks: Block[] = [paragraph(`command not found: /${name}`, 'error')];
  if (suggestions.length > 0) {
    blocks.push(paragraph([text('Did you mean ', 'muted'), ...joined(suggestions, ' or '), text('?', 'muted')]));
  } else {
    // Only real content counts: a project's limitations include notes on where its facts come from ("from Alex's CV").
    const mentions = context.kb.search(name, 3).filter((hit) => hit.matches.some(({ field }) => field !== 'limitations'));
    if (mentions.length > 0) {
      blocks.push(
        paragraph([
          text(`"${name}" appears in `, 'muted'),
          ...joined(mentions.map((hit) => command(hit.projectName, `/projects ${hit.projectId}`)), ', '),
          text('.', 'muted'),
        ]),
      );
    }
  }
  blocks.push(
    paragraph([
      text('Type ', 'muted'),
      command('/help'),
      text(' for the list of commands. Anything without a "/" goes to the assistant.', 'muted'),
    ]),
  );
  return { blocks };
}
