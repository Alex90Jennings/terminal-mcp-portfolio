import { askOrFallback } from '../ask';
import { bullets, command, heading, paragraph, subheading, text, type Block } from '../output';
import type { Command } from '../types';
import { WELCOME_QUESTIONS, interviewGuide } from './recruiter';

export const ask: Command = {
  name: 'ask',
  aliases: [],
  summary: 'Ask any question about Alex in plain English (either interview)',
  usage: 'ask <question>',
  run: (args, context) => {
    const question = args.join(' ').trim();
    // On its own, `ask` shows how to use the interview and questions to try.
    if (question === '') return { blocks: interviewGuide(context) };
    return askOrFallback(question, context);
  },
};

export const help: Command = {
  name: 'help',
  aliases: ['?', 'man', 'commands'],
  summary: 'Show this list of commands',
  run: (_args, { commands, aiAvailable }) => {
    const blocks: Block[] = [
      heading('Commands'),
      {
        kind: 'definitions',
        rows: commands.map((entry) => ({
          term: [command(entry.usage ?? entry.name, entry.name)],
          detail: [
            entry.summary,
            ...(entry.aliases.length > 0 ? [text(`  (also: ${entry.aliases.join(', ')})`, 'muted')] : []),
          ],
        })),
      },
      subheading('Tips'),
      {
        kind: 'list',
        items: [
          [text('Open a project by number or name on its own: '), command('3'), text(' or '), command('sol')],
          [text('Tab completes commands and project names; ↑ and ↓ step through history')],
          [text('Ctrl+L clears the screen; Esc clears the line')],
          [
            text(
              aiAvailable
                ? 'Ask about my work in plain English, e.g. "Which project best demonstrates Docker?" Follow-up questions work too; Ctrl+C or Esc stops an answer.'
                : 'Questions in plain English will be answered once the AI assistant is connected. Until then you get the matching projects.',
            ),
          ],
        ].map((line) => ({ lines: [line] })),
      },
    ];
    return { blocks };
  },
};

export const history: Command = {
  name: 'history',
  aliases: [],
  summary: 'Show the commands you have entered',
  run: (_args, context) => {
    if (context.history.length === 0) return { blocks: [paragraph('No commands yet.', 'muted')] };
    return {
      blocks: [
        {
          kind: 'list',
          ordered: true,
          items: context.history.map((entry, index) => ({
            marker: `${index + 1}`,
            lines: [[command(entry)]],
          })),
        },
      ],
    };
  },
};

export const clear: Command = {
  name: 'clear',
  aliases: ['cls'],
  summary: 'Clear the screen',
  run: () => ({ blocks: [], clear: true }),
};

/**
 * The greeting shown on load. Not a command; built from the profile so nothing is hard-coded. It says what this is (a
 * first-stage interview), that plain English works, where to look, and offers questions that run exactly as if typed.
 * Kept short, so it fits a phone screen with the prompt still visible.
 */
export function welcome(context: { kb: { profile: { name: string; title: string } } }): Block[] {
  const { profile } = context.kb;
  const firstName = profile.name.split(' ')[0];
  return [
    { kind: 'title', text: profile.name },
    paragraph(text(profile.title, 'accent')),
    paragraph(`Hi, I’m ${firstName}. Welcome to my interactive portfolio: think of it as a first-stage interview.`),
    {
      kind: 'actions',
      label: 'Choose an interview',
      items: [
        { title: 'First Round Interview', detail: 'Background, experience, soft skills', command: 'first-round' },
        { title: 'Technical Interview', detail: 'Engineering, architecture, trade-offs', command: 'technical' },
      ],
    },
    paragraph(text('Or ask anything in plain English. Try:', 'muted')),
    bullets(WELCOME_QUESTIONS.map((question) => [command(question)])),
  ];
}
