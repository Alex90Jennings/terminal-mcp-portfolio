import type { KnowledgeBase } from '@portfolio/knowledge/runtime';
import { PROJECT_SECTIONS, formatProject, resolveSection } from '../format-project';
import { command, heading, joined, paragraph, text, type Block, type CommandResult } from '../output';
import type { Command } from '../types';

export const projects: Command = {
  name: 'projects',
  aliases: ['project', 'ls', 'work'],
  summary: 'List the featured projects, or open one by name, alias or number',
  usage: 'projects [name|number] [section]',
  run: (args, { kb }) => {
    const [target, section, ...rest] = args;
    if (target === undefined) return listProjects(kb);

    // A multi-word name typed without quotes, e.g. `projects clash of langs`, wins over a section.
    const byFullName = args.length > 1 ? kb.getProject(args.join(' ')) : undefined;
    if (byFullName !== undefined) return { blocks: formatProject(byFullName, 'overview', kb) };

    const project = kb.getProject(target);
    if (project === undefined) return projectNotFound(kb, args.join(' '));

    const resolved = resolveSection(section);
    if (resolved === undefined || rest.length > 0) {
      return {
        blocks: [
          paragraph(`Unknown section "${args.slice(1).join(' ')}".`, 'error'),
          paragraph([
            text('Sections: ', 'muted'),
            ...joined(PROJECT_SECTIONS.map((name) => command(name, `/projects ${project.id} ${name}`))),
          ]),
        ],
      };
    }
    return { blocks: formatProject(project, resolved, kb) };
  },
  complete: (args, { kb }) => {
    if (args.length <= 1) return kb.projects.map(({ id }) => id);
    if (args.length === 2 && kb.getProject(args[0] ?? '')) return PROJECT_SECTIONS;
    return [];
  },
};

export function listProjects(kb: KnowledgeBase): CommandResult {
  const blocks: Block[] = [
    heading('Available projects'),
    {
      kind: 'list',
      ordered: true,
      items: kb.projects.map((project, index) => ({
        marker: `[${index + 1}]`,
        lines: [
          [command(project.name, `/projects ${project.id}`)],
          [text(project.focus, 'accent')],
          joined(project.listingTags.map((tag) => text(tag, 'muted'))),
        ],
      })),
    },
    paragraph([
      text('Type ', 'muted'),
      command('/projects <name>', '/projects'),
      text(' or a number to explore, e.g. ', 'muted'),
      command('/projects 3', '/projects 3'),
      text('.', 'muted'),
    ]),
  ];
  return { blocks };
}

function projectNotFound(kb: KnowledgeBase, input: string): CommandResult {
  const suggestions = kb.suggestProjectIds(input);
  return {
    blocks: [
      paragraph(`No project called "${input}".`, 'error'),
      ...(suggestions.length > 0
        ? [paragraph([text('Did you mean ', 'muted'), ...joined(suggestions.map((id) => command(id, `/projects ${id}`)), ' or '), text('?', 'muted')])]
        : []),
      paragraph([
        text('Projects: ', 'muted'),
        ...joined(kb.projects.map((project) => command(project.id, `/projects ${project.id}`))),
      ]),
    ],
  };
}
