import { command, paragraph, text, type Block, type CommandResult } from './output';
import type { CommandContext } from './types';

/** A question goes to the AI assistant when it is enabled; the local answer is kept as its fallback. */
export function askOrFallback(question: string, context: CommandContext): CommandResult {
  const fallback = answerWithoutAi(question, context);
  return context.aiAvailable ? { blocks: [], ask: { question, fallback } } : { blocks: fallback };
}

/** Without the AI assistant, a question still gets something useful: the projects that match it. */
export function answerWithoutAi(question: string, { kb }: CommandContext): Block[] {
  const hits = kb.search(question, 3);
  const blocks: Block[] = [
    paragraph('The AI assistant isn’t available right now, so I can’t answer questions in plain English yet.', 'muted'),
  ];
  if (hits.length > 0) {
    blocks.push(paragraph('These projects look relevant:'), {
      kind: 'list',
      items: hits.map((hit) => ({
        lines: [
          [command(hit.projectName, `/projects ${hit.projectId}`)],
          ...(hit.matches[0] ? [[text(hit.matches[0].text, 'muted')]] : []),
        ],
      })),
    });
  }
  blocks.push(paragraph([text('Or browse with ', 'muted'), command('/projects'), text(' and ', 'muted'), command('/skills'), text('.', 'muted')]));
  return blocks;
}
