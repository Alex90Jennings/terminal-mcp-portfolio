import {
  COMPETENCY_GROUP_LABELS,
  STAR_PARTS,
  STORY_ATTRIBUTION_LABELS,
  storyBasis,
  storyPartText,
  type Competency,
  type Interest,
  type KnowledgeBase,
  type Story,
} from '@portfolio/knowledge/runtime';
import { bullets, command, heading, joined, paragraph, subheading, text, type Block, type CommandResult } from '../output';
import type { Command } from '../types';

/*
 * Soft skills, stories and interests. Everything shown comes from the
 * published evidence in the knowledge base: a competency appears only with a
 * real example, and drafts never reach a public build.
 */

const BASIS = {
  documented: 'Based on project records',
  firsthand: "Based on Alex's own account",
  mixed: "Based on project records and Alex's own account",
} as const;

/** Shown above evidence output in a local preview build, so drafts are never mistaken for published content. */
function previewNotice(kb: KnowledgeBase): Block[] {
  return kb.preview ? [paragraph('Preview: draft stories awaiting Alex’s review. Not in the published site.', 'error')] : [];
}

function storyBlocks(story: Story, kb: KnowledgeBase, version: 'short' | 'detailed'): Block[] {
  const blocks: Block[] = [heading(story.title)];
  if (story.organisation) blocks.push(paragraph(story.organisation, 'muted'));
  blocks.push(paragraph(toldAsOne(story, version)));
  const competencies = story.competencies.flatMap((id) => {
    const competency = kb.getCompetency(id);
    return competency ? [command(competency.name, `soft-skills ${competency.id}`)] : [];
  });
  blocks.push(
    paragraph([text('Who did what: ', 'muted'), story.attributionNote]),
    paragraph(text(BASIS[storyBasis(story)], 'muted')),
  );
  if (competencies.length > 0) blocks.push(paragraph([text('Skills: ', 'muted'), ...joined(competencies)]));
  if (story.projects.length > 0) {
    blocks.push(paragraph([text('Projects: ', 'muted'), ...joined(story.projects.map((id) => command(kb.getProject(id)?.name ?? id, `projects ${id}`)))]));
  }
  if (version === 'short' && hasMore(story)) blocks.push(paragraph([text('More detail: ', 'muted'), command(`stories ${story.id} full`)]));
  return blocks;
}

/**
 * The story as one paragraph, without part labels. Most of it is what Alex did: the action is always told in full,
 * while the background, the task and the outcome stay short unless the detailed version is asked for.
 */
function toldAsOne(story: Story, version: 'short' | 'detailed'): string {
  const parts = STAR_PARTS.map((part) => storyPartText(story[part], part === 'action' ? 'detailed' : version));
  if (version === 'detailed' && story.reflection) parts.push(storyPartText(story.reflection, 'detailed'));
  return parts.join(' ');
}

const hasMore = (story: Story) => [story.situation, story.task, story.result].some((part) => part.detail !== undefined) || story.reflection !== undefined;

function noEvidence(kb: KnowledgeBase, what: string): CommandResult {
  return { blocks: [...previewNotice(kb), paragraph(`No ${what} are published yet.`, 'muted')] };
}

export const softSkills: Command = {
  name: 'soft-skills',
  aliases: ['softskills', 'competencies', 'strengths'],
  summary: 'Soft skills and ways of working, each shown through a real example',
  usage: 'soft-skills [skill|questions]',
  run: (args, { kb }) => {
    const competencies = kb.evidence.competencies;
    if (competencies.length === 0) return noEvidence(kb, 'soft-skill examples');
    const [first, ...rest] = args;
    if (first === undefined) return listCompetencies(kb);
    if (first.toLowerCase() === 'questions') {
      const target = rest.join(' ');
      return questions(kb, target === '' ? undefined : resolveCompetency(kb, target));
    }
    const competency = resolveCompetency(kb, args.join(' '));
    if (competency === undefined) {
      return {
        blocks: [paragraph(`No soft skill called "${args.join(' ')}".`, 'error'), paragraph([text('See '), command('soft-skills'), text(' for the list.')], 'muted')],
      };
    }
    return showCompetency(kb, competency);
  },
  complete: (args, { kb }) => (args.length <= 1 ? ['questions', ...kb.evidence.competencies.map(({ id }) => id)] : []),
};

/** By id, name or list number ("3", "problem-solving", "Problem-solving"). */
function resolveCompetency(kb: KnowledgeBase, input: string): Competency | undefined {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return kb.evidence.competencies[Number(trimmed) - 1];
  return kb.getCompetency(trimmed);
}

function listCompetencies(kb: KnowledgeBase): CommandResult {
  const blocks: Block[] = [...previewNotice(kb)];
  const all = kb.evidence.competencies;
  for (const group of ['core', 'mindset'] as const) {
    const inGroup = all.filter((competency) => competency.group === group);
    if (inGroup.length === 0) continue;
    blocks.push(heading(COMPETENCY_GROUP_LABELS[group]), {
      kind: 'list',
      ordered: true,
      items: inGroup.map((competency) => ({
        marker: String(all.indexOf(competency) + 1).padStart(2, '0'),
        lines: [[command(competency.name, `soft-skills ${competency.id}`), text(`  ${competency.stories.length} example${competency.stories.length === 1 ? '' : 's'}`, 'muted')]],
      })),
    });
  }
  blocks.push(paragraph([text('Choose one to see a real example, or see ', 'muted'), command('soft-skills questions'), text(' and ', 'muted'), command('stories'), text('.', 'muted')]));
  return { blocks };
}

function showCompetency(kb: KnowledgeBase, competency: Competency): CommandResult {
  const stories = competency.stories.flatMap((id) => (kb.getStory(id) ? [kb.getStory(id)!] : []));
  const [strongest, ...others] = stories;
  const blocks: Block[] = [...previewNotice(kb), heading(competency.name), paragraph(competency.description, 'muted')];
  if (strongest === undefined) {
    blocks.push(paragraph('No example is published for this yet.', 'muted'));
  } else {
    blocks.push(paragraph(text('Example', 'accent', true)), ...storyBlocks(strongest, kb, 'short'));
  }
  if (others.length > 0) blocks.push(subheading('More examples'), bullets(others.map((story) => [command(story.title, `stories ${story.id}`)])));
  if (competency.gap) blocks.push(paragraph([text('Evidence gap: ', 'muted'), competency.gap]));
  blocks.push(paragraph([text('Interview questions: ', 'muted'), command(`soft-skills questions ${competency.id}`)]));
  return { blocks };
}

function questions(kb: KnowledgeBase, only: Competency | undefined): CommandResult {
  const chosen = only ? [only] : kb.evidence.competencies;
  const blocks: Block[] = [...previewNotice(kb), heading(only ? `Questions: ${only.name}` : 'Interview questions')];
  for (const competency of chosen) {
    if (!only) blocks.push(subheading(competency.name));
    blocks.push(bullets(competency.questions.map((question) => [question])));
    const best = competency.stories[0];
    if (best && kb.getStory(best)) blocks.push(paragraph([text('Best answered by: ', 'muted'), command(kb.getStory(best)!.title, `stories ${best}`)]));
  }
  return { blocks };
}

export const stories: Command = {
  name: 'stories',
  aliases: ['examples'],
  summary: 'Real examples from my work, each told as a short story (also in the First Round Interview)',
  usage: 'stories [story] [full]',
  run: (args, { kb }) => {
    const stories = kb.evidence.stories;
    if (stories.length === 0) return noEvidence(kb, 'stories');
    // `stories list` and `stories show <id>` are accepted as well as `stories` and `stories <id>`.
    const words = args.filter((word, index) => !(index === 0 && (word === 'show' || word === 'list')));
    if (words.length === 0) return listStories(kb);
    const full = words.at(-1) === 'full' || words.at(-1) === 'detailed';
    const target = (full ? words.slice(0, -1) : words).join(' ');
    const story = /^\d+$/.test(target) ? stories[Number(target) - 1] : kb.getStory(target);
    if (story === undefined) {
      return { blocks: [paragraph(`No story called "${target}".`, 'error'), paragraph([text('See '), command('stories'), text(' for the list.')], 'muted')] };
    }
    return { blocks: [...previewNotice(kb), ...storyBlocks(story, kb, full ? 'detailed' : 'short')] };
  },
  complete: (args, { kb }) => {
    if (args.length <= 1) return kb.evidence.stories.map(({ id }) => id);
    if (args.length === 2 && kb.getStory(args[0] ?? '')) return ['full'];
    return [];
  },
};

function listStories(kb: KnowledgeBase): CommandResult {
  return {
    blocks: [
      ...previewNotice(kb),
      heading('Stories'),
      {
        kind: 'list',
        ordered: true,
        items: kb.evidence.stories.map((story, index) => ({
          marker: `[${index + 1}]`,
          lines: [
            [command(story.title, `stories ${story.id}`)],
            [text([story.organisation ?? kb.getProject(story.projects[0] ?? '')?.name, STORY_ATTRIBUTION_LABELS[story.attribution]].filter(Boolean).join(' · '), 'muted')],
          ],
        })),
      },
      paragraph([text('Open one by name or number, e.g. ', 'muted'), command(`stories ${kb.evidence.stories[0]!.id}`)]),
    ],
  };
}

export const interests: Command = {
  name: 'interests',
  aliases: ['hobbies', 'motivation'],
  summary: 'What I enjoy, in and out of software, and why I do this work',
  run: (_args, { kb }) => {
    const { interests: found, background } = kb.evidence;
    const sections: [string, readonly Interest[]][] = [
      ['Personal interests', found.personal],
      ['Technical interests', found.technical],
      ['Why software', background.motivation],
      ['Working style', background.workingEnvironment],
    ];
    if (sections.every(([, items]) => items.length === 0)) return noEvidence(kb, 'interests');
    const blocks: Block[] = [...previewNotice(kb)];
    for (const [title, items] of sections) {
      if (items.length === 0) continue;
      blocks.push(heading(title), {
        kind: 'list',
        items: items.map((item) => ({
          lines: [
            [text(item.title, 'accent', true)],
            [item.text],
            ...(item.projects.length > 0 ? [[text('See: ', 'muted'), ...joined(item.projects.map((id) => command(kb.getProject(id)?.name ?? id, `projects ${id}`)))]] : []),
          ],
        })),
      });
    }
    blocks.push(paragraph(text("From Alex's own account.", 'muted')));
    return { blocks };
  },
};
