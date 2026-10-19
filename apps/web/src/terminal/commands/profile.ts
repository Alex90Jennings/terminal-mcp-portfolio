import type { Skill } from '@portfolio/knowledge/runtime';
import { bullets, command, heading, joined, link, paragraph, subheading, text, type Block, type Inline } from '../output';
import type { Command } from '../types';

export const about: Command = {
  name: 'about',
  aliases: ['whoami', 'bio'],
  summary: 'Who I am, my experience and education',
  run: (_args, { kb }) => {
    const { profile } = kb;
    const projectName = (id: string) => kb.getProject(id)?.name ?? id;
    const blocks: Block[] = [
      heading(profile.name),
      paragraph(joined([text(profile.title, 'accent'), text(profile.location, 'muted')])),
      bullets(profile.summary.map(({ text: fact }) => [fact])),
    ];
    if (profile.experience.length > 0) {
      blocks.push(
        subheading('Experience'),
        {
          kind: 'list',
          items: profile.experience.map((role) => ({
            lines: [
              [text(`${role.role}, ${role.organisation}`, undefined, true), text(`  ${role.period}`, 'muted')],
              ...(role.projects.length > 0
                ? [[text('Projects: ', 'muted'), ...joined(role.projects.map((id) => command(projectName(id), `projects ${id}`)))]]
                : []),
            ],
          })),
        },
      );
    }
    if (profile.education.length > 0) {
      blocks.push(subheading('Education'), {
        kind: 'list',
        items: profile.education.map((item) => ({
          lines: [
            [text(item.qualification, undefined, true)],
            [text([item.institution, item.period].filter(Boolean).join(' · '), 'muted')],
          ],
        })),
      });
    }
    if (profile.certifications.length > 0) {
      blocks.push(
        subheading('Certifications'),
        bullets(
          profile.certifications.map((cert) => [
            cert.name,
            text(cert.progress === 'in-progress' ? '  in progress' : cert.date ? `  ${cert.date}` : '', 'muted'),
          ]),
        ),
      );
    }
    if (profile.languages.length > 0) {
      blocks.push(subheading('Languages'), paragraph(joined(profile.languages.map(({ language, level }) => `${language} (${level})`))));
    }
    blocks.push(
      paragraph([
        text('Next: ', 'muted'),
        ...joined([command('projects'), command('skills'), command('approach'), command('contact')]),
      ]),
    );
    return { blocks };
  },
};

const CATEGORY_LABELS: Record<Skill['category'], string> = {
  language: 'Languages',
  frontend: 'Frontend',
  mobile: 'Mobile & native',
  backend: 'Backend',
  data: 'Data',
  cloud: 'Cloud',
  devops: 'DevOps',
  ai: 'AI',
  quality: 'Quality',
  practice: 'Practice',
};

export const skills: Command = {
  name: 'skills',
  aliases: ['stack', 'tech'],
  summary: 'Technical skills and the projects that demonstrate them',
  run: (_args, { kb }) => {
    const byCategory = new Map<Skill['category'], Skill[]>();
    for (const skill of kb.skills) byCategory.set(skill.category, [...(byCategory.get(skill.category) ?? []), skill]);

    const blocks: Block[] = [heading('Skills')];
    for (const [category, skillsInCategory] of byCategory) {
      blocks.push(subheading(CATEGORY_LABELS[category]), {
        kind: 'definitions',
        rows: skillsInCategory.map((skill) => ({
          term: [skill.name],
          detail:
            skill.projects.length > 0
              ? joined(skill.projects.map((id) => command(kb.getProject(id)?.name ?? id, `projects ${id}`)))
              : [text('Professional practice (see about)', 'muted')],
        })),
      });
    }
    return { blocks };
  },
};

export const approach: Command = {
  name: 'approach',
  aliases: ['ai', 'process', 'workflow'],
  summary: 'How I work, and where AI fits in',
  run: (_args, { kb }) => {
    const working = kb.profile.workingApproach;
    if (working === undefined) return { blocks: [paragraph('No working approach is documented yet.', 'muted')] };
    const blocks: Block[] = [
      heading('How I work'),
      paragraph(working.summary, 'muted'),
      {
        kind: 'list',
        ordered: true,
        items: working.steps.map((step, index) => ({
          marker: `${index + 1}.`,
          lines: [[text(step.title, 'accent', true)], [step.description]],
        })),
      },
    ];
    if (working.ai.length > 0) blocks.push(subheading('On AI'), bullets(working.ai.map(({ text: fact }) => [fact])));
    return { blocks };
  },
};

export const contact: Command = {
  name: 'contact',
  aliases: ['email', 'links', 'hire'],
  summary: 'How to get in touch',
  run: (_args, { kb }) => {
    const { email, links } = kb.profile.contact;
    const rows: { term: Inline[]; detail: Inline[] }[] = [
      { term: ['Email'], detail: [link(email, `mailto:${email}`)] },
      ...links.map(({ label, url }) => ({ term: [label], detail: [link(url.replace(/^https:\/\//, ''), url)] })),
    ];
    return { blocks: [heading('Contact'), { kind: 'definitions', rows }] };
  },
};
