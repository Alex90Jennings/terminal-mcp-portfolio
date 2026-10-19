import {
  experienceOf,
  PROJECT_CONTEXT_LABELS,
  RESPONSIBILITY_SCOPE_LABELS,
  SKILL_CATEGORY_LABELS,
  type KnowledgeBase,
  type PortfolioProject,
  type Skill,
  type Source,
} from '@portfolio/knowledge';
import { projectUri } from './uris.ts';

/*
 * Markdown documents for MCP resources. Every claim carries a footnote naming
 * its sources (`[^cv]`), and each document ends with the source list, so
 * attribution survives however a client displays or quotes the text.
 */

class Citations {
  private readonly used = new Set<string>();

  constructor(private readonly sources: readonly Source[]) {}

  /** Footnote references for a claim, e.g. " [^cv][^readme]". */
  cite(ids: readonly string[]): string {
    ids.forEach((id) => this.used.add(id));
    return ids.map((id) => `[^${id}]`).join('');
  }

  section(): string[] {
    const cited = this.sources.filter(({ id }) => this.used.has(id));
    if (cited.length === 0) return [];
    return ['## Sources', '', ...cited.map(({ id, label, url }) => `[^${id}]: ${url ? `[${label}](${url})` : label}`), ''];
  }
}

const bullet = (text: string, citation: string) => `- ${text} ${citation}`.trimEnd();

export function renderProjectMarkdown(project: PortfolioProject): string {
  const citations = new Citations(project.sources);
  const { context } = project;
  const role = [context.role, context.organisation].filter(Boolean).join(', ');
  const lines: string[] = [
    `# ${project.name}`,
    '',
    `> ${project.tagline}`,
    '',
    `- **Focus:** ${project.focus}`,
    `- **Context:** ${PROJECT_CONTEXT_LABELS[context.kind]}${role ? ` (${role})` : ''}${context.period ? `, ${context.period}` : ''}`,
    `- **Tags:** ${project.listingTags.join(' · ')}`,
    '',
  ];

  const list = (heading: string, facts: readonly { text: string; sources: string[] }[]) => {
    if (facts.length === 0) return;
    lines.push(`## ${heading}`, '', ...facts.map((fact) => bullet(fact.text, citations.cite(fact.sources))), '');
  };

  list('Overview', project.overview);
  if (project.responsibilities.length > 0) {
    lines.push(
      '## Responsibilities',
      '',
      ...project.responsibilities.map((item) =>
        bullet(`${item.text} *(${RESPONSIBILITY_SCOPE_LABELS[item.scope]})*`, citations.cite(item.sources)),
      ),
      '',
    );
  }
  if (project.technologies.length > 0) {
    lines.push(
      '## Technologies',
      '',
      ...project.technologies.map((tech) => bullet(`${tech.name} (${tech.category})`, citations.cite(tech.sources))),
      '',
    );
  }
  if (project.architecture.overview.length > 0 || project.architecture.diagrams.length > 0) {
    lines.push('## Architecture', '');
    lines.push(...project.architecture.overview.map((fact) => bullet(fact.text, citations.cite(fact.sources))), '');
    for (const diagram of project.architecture.diagrams) {
      lines.push(`### ${diagram.title} ${citations.cite(diagram.sources)}`, '', '```mermaid', diagram.source, '```', '');
    }
  }
  if (project.challenges.length > 0) {
    lines.push('## Engineering challenges', '');
    for (const challenge of project.challenges) {
      lines.push(`### ${challenge.title} ${citations.cite(challenge.sources)}`, '', `**Problem:** ${challenge.problem}`, '', '**Approach:**', '');
      lines.push(...challenge.approach.map((step) => `- ${step}`), '');
      if (challenge.outcome) lines.push(`**Outcome:** ${challenge.outcome}`, '');
    }
  }
  if (project.decisions.length > 0) {
    lines.push('## Decisions', '');
    for (const decision of project.decisions) {
      lines.push(`### ${decision.title} ${citations.cite(decision.sources)}`, '', decision.decision, '', `**Why:** ${decision.rationale}`, '');
      if (decision.alternatives.length > 0) lines.push('**Alternatives considered:**', '', ...decision.alternatives.map((item) => `- ${item}`), '');
      if (decision.tradeoffs.length > 0) lines.push('**Trade-offs:**', '', ...decision.tradeoffs.map((item) => `- ${item}`), '');
    }
  }
  list('Lessons learned', project.lessons);
  list('Known limitations', project.limitations);
  if (project.links.length > 0) lines.push('## Links', '', ...project.links.map(({ label, url }) => `- [${label}](${url})`), '');
  if (project.undocumented.length > 0) {
    lines.push('## Not documented yet', '', 'Ask Alex directly about these; nothing here should be inferred:', '', ...project.undocumented.map((item) => `- ${item}`), '');
  }
  lines.push(...citations.section());
  return lines.join('\n');
}

export function renderProjectIndexMarkdown(kb: KnowledgeBase): string {
  return [
    '# Featured projects',
    '',
    ...kb.projects.map(
      (project, index) => `${index + 1}. [${project.name}](${projectUri(project.id)}): **${project.focus}**. ${project.tagline}`,
    ),
    '',
    'Each project’s full documentation is available at `portfolio://projects/{id}`.',
    '',
  ].join('\n');
}

export function renderProfileMarkdown(kb: KnowledgeBase): string {
  const { profile } = kb;
  const citations = new Citations(profile.sources);
  const experience = experienceOf(kb);
  const lines: string[] = [
    `# ${profile.name}`,
    '',
    `**${profile.title}** · ${profile.location}`,
    '',
    '## Summary',
    '',
    ...profile.summary.map((fact) => bullet(fact.text, citations.cite(fact.sources))),
    '',
  ];

  if (experience.employment.length > 0) {
    lines.push('## Employment', '');
    for (const role of experience.employment) {
      lines.push(`- **${role.role}, ${role.organisation}**, ${role.period} ${citations.cite(role.sources)}`.trimEnd());
      for (const project of role.projects) lines.push(`  - [${project.name}](${projectUri(project.id)})`);
    }
    lines.push('');
  }
  if (experience.education.length > 0) {
    lines.push(
      '## Education',
      '',
      ...experience.education.map((item) =>
        bullet(`**${item.qualification}**, ${item.institution}${item.period ? `, ${item.period}` : ''}`, citations.cite(item.sources)),
      ),
      '',
    );
  }
  if (experience.certifications.length > 0) {
    lines.push(
      '## Certifications',
      '',
      ...experience.certifications.map((cert) =>
        bullet(`${cert.name} (${cert.progress === 'in-progress' ? 'in progress' : (cert.date ?? 'earned')})`, citations.cite(cert.sources)),
      ),
      '',
    );
  }
  const working = profile.workingApproach;
  if (working !== undefined) {
    lines.push('## How I work', '', working.summary, '');
    lines.push(...working.steps.map((step, index) => `${index + 1}. **${step.title}:** ${step.description} ${citations.cite(step.sources)}`.trimEnd()), '');
    if (working.ai.length > 0) lines.push('### On AI', '', ...working.ai.map((fact) => bullet(fact.text, citations.cite(fact.sources))), '');
  }
  if (profile.languages.length > 0) {
    lines.push('## Languages', '', ...profile.languages.map((item) => bullet(`${item.language}: ${item.level}`, citations.cite(item.sources))), '');
  }
  lines.push(
    '## Contact',
    '',
    `- Email: ${profile.contact.email}`,
    ...profile.contact.links.map(({ label, url }) => `- ${label}: [${url}](${url})`),
    '',
    ...citations.section(),
  );
  return lines.join('\n');
}

export function renderSkillsMarkdown(kb: KnowledgeBase): string {
  const citations = new Citations(kb.skillSources);
  const byCategory = new Map<Skill['category'], Skill[]>();
  for (const skill of kb.skills) byCategory.set(skill.category, [...(byCategory.get(skill.category) ?? []), skill]);

  const lines = ['# Skills', ''];
  for (const [category, skills] of byCategory) {
    lines.push(`## ${SKILL_CATEGORY_LABELS[category]}`, '');
    for (const skill of skills) {
      const projects = skill.projects.map((id) => `[${kb.getProject(id)?.name ?? id}](${projectUri(id)})`).join(', ');
      lines.push(bullet(`**${skill.name}**${projects ? `: ${projects}` : ''}`, citations.cite(skill.sources)));
    }
    lines.push('');
  }
  lines.push(...citations.section());
  return lines.join('\n');
}
