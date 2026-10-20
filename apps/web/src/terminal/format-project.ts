import { PROJECT_CONTEXT_LABELS, RESPONSIBILITY_SCOPE_LABELS, projectEvidence, type KnowledgeBase, type PortfolioProject } from '@portfolio/knowledge/runtime';
import { bullets, command, heading, joined, link, paragraph, subheading, text, type Block, type Inline } from './output';

export const PROJECT_SECTIONS = ['overview', 'architecture', 'challenges', 'decisions', 'lessons', 'sources', 'all'] as const;
export type ProjectSection = (typeof PROJECT_SECTIONS)[number];

const SECTION_ALIASES: Record<string, ProjectSection> = {
  arch: 'architecture',
  design: 'architecture',
  challenge: 'challenges',
  decision: 'decisions',
  lesson: 'lessons',
  limitations: 'lessons',
  source: 'sources',
  links: 'sources',
};

export function resolveSection(input: string | undefined): ProjectSection | undefined {
  if (input === undefined) return 'overview';
  const key = input.toLowerCase();
  return (PROJECT_SECTIONS as readonly string[]).includes(key) ? (key as ProjectSection) : SECTION_ALIASES[key];
}

/** With `kb`, the overview also shows the stories and skills the project demonstrates. */
export function formatProject(project: PortfolioProject, section: ProjectSection, kb?: KnowledgeBase): Block[] {
  const blocks: Block[] = [heading(project.name), ...summary(project)];
  const parts: Record<Exclude<ProjectSection, 'all' | 'overview'>, () => Block[]> = {
    architecture: () => architecture(project),
    challenges: () => challenges(project),
    decisions: () => decisions(project),
    lessons: () => lessons(project),
    sources: () => sources(project),
  };

  if (section === 'overview') {
    blocks.push(...overview(project, kb), ...linkSection(project), ...more(project));
  } else if (section === 'all') {
    blocks.push(...overview(project, kb));
    for (const build of Object.values(parts)) blocks.push(...build());
  } else {
    const content = parts[section]();
    blocks.push(...(content.length > 0 ? content : [paragraph(`No ${section} are documented for ${project.name} yet.`, 'muted')]));
    blocks.push(...more(project, section));
  }
  return blocks;
}

function summary(project: PortfolioProject): Block[] {
  const { context } = project;
  const where = [context.role, context.organisation].filter(Boolean).join(', ');
  const meta = [project.focus, PROJECT_CONTEXT_LABELS[context.kind] + (where ? ` · ${where}` : ''), context.period].filter(
    (part): part is string => Boolean(part),
  );
  return [paragraph(joined(meta.map((part) => text(part, 'accent')))), paragraph(project.tagline)];
}

/** Alex's role and what the project shows come first; the description, challenges and technology list follow. */
function overview(project: PortfolioProject, kb?: KnowledgeBase): Block[] {
  const blocks: Block[] = [];
  if (project.responsibilities.length > 0) {
    blocks.push(
      subheading("Alex's role"),
      bullets(project.responsibilities.map((item) => [item.text, text(` (${RESPONSIBILITY_SCOPE_LABELS[item.scope]})`, 'muted')])),
    );
  }
  if (kb !== undefined) blocks.push(...demonstrates(project, kb));
  if (project.overview.length > 0) blocks.push(subheading('About the project'), bullets(project.overview.map(({ text: fact }) => [fact])));
  if (project.challenges.length > 0) {
    blocks.push(
      subheading('Engineering challenges'),
      bullets(project.challenges.map(({ title }) => [title])),
    );
  }
  if (project.technologies.length > 0) {
    blocks.push(subheading('Technology'), paragraph(joined(project.technologies.map(({ name }) => name))));
  }
  return blocks;
}

/** The skills and stories this project evidences, each a link to the full example or skill. */
function demonstrates(project: PortfolioProject, kb: KnowledgeBase): Block[] {
  const { stories, competencies, skills } = projectEvidence(kb, project.id);
  if (stories.length + competencies.length + skills.length === 0) return [];
  const lines: Inline[][] = [];
  if (competencies.length > 0) lines.push([text('Soft skills: ', 'muted'), ...joined(competencies.map(({ id, name }) => command(name, `soft-skills ${id}`)))]);
  if (skills.length > 0) lines.push([text('Technical skills: ', 'muted'), ...joined(skills.map(({ name }) => text(name)))]);
  const blocks: Block[] = [subheading('What it demonstrates'), ...lines.map((line) => paragraph(line))];
  if (stories.length > 0) blocks.push(subheading('Examples'), bullets(stories.map((story) => [command(story.title, `stories ${story.id}`)])));
  return blocks;
}

function architecture(project: PortfolioProject): Block[] {
  if (project.architecture.overview.length === 0) return [];
  return [subheading('Architecture'), bullets(project.architecture.overview.map(({ text: fact }) => [fact]))];
}

function challenges(project: PortfolioProject): Block[] {
  return project.challenges.flatMap((challenge) => [
    subheading(challenge.title),
    paragraph([text('Problem: ', 'muted'), challenge.problem]),
    bullets(challenge.approach.map((step) => [step])),
    ...(challenge.outcome ? [paragraph([text('Outcome: ', 'muted'), challenge.outcome])] : []),
  ]);
}

function decisions(project: PortfolioProject): Block[] {
  return project.decisions.flatMap((decision) => [
    subheading(decision.title),
    paragraph(decision.decision),
    paragraph([text('Why: ', 'muted'), decision.rationale]),
    ...(decision.alternatives.length > 0
      ? [paragraph(text('Alternatives considered:', 'muted')), bullets(decision.alternatives.map((item) => [item]))]
      : []),
    ...(decision.tradeoffs.length > 0
      ? [paragraph(text('Trade-offs:', 'muted')), bullets(decision.tradeoffs.map((item) => [item]))]
      : []),
  ]);
}

function lessons(project: PortfolioProject): Block[] {
  const blocks: Block[] = [];
  if (project.lessons.length > 0) blocks.push(subheading('Lessons learned'), bullets(project.lessons.map(({ text: fact }) => [fact])));
  if (project.limitations.length > 0) {
    blocks.push(subheading('Known limitations'), bullets(project.limitations.map(({ text: fact }) => [fact])));
  }
  return blocks;
}

function linkSection(project: PortfolioProject): Block[] {
  if (project.links.length === 0) return [];
  return [subheading('Links'), bullets(project.links.map(({ label, url }) => [link(label, url)]))];
}

function sources(project: PortfolioProject): Block[] {
  const blocks: Block[] = [
    subheading('Sources'),
    paragraph('Every statement about this project is backed by one of these:', 'muted'),
    bullets(project.sources.map(({ label, url }): Inline[] => [url ? link(label, url) : label])),
  ];
  if (project.undocumented.length > 0) {
    blocks.push(subheading('Not documented yet'), bullets(project.undocumented.map((item) => [item])));
  }
  return blocks;
}

function more(project: PortfolioProject, current?: ProjectSection): Block[] {
  const available: ProjectSection[] = [];
  if (current !== undefined) available.push('overview');
  if (project.architecture.overview.length > 0) available.push('architecture');
  if (project.challenges.length > 0) available.push('challenges');
  if (project.decisions.length > 0) available.push('decisions');
  if (project.lessons.length + project.limitations.length > 0) available.push('lessons');
  available.push('sources');
  const options = available.filter((section) => section !== current);
  return [
    paragraph([
      text('More: ', 'muted'),
      ...joined(options.map((section) => command(section, `projects ${project.id} ${section}`))),
    ]),
  ];
}
