import { RESPONSIBILITY_SCOPE_LABELS, experienceOf, projectEvidence, type Story } from '@portfolio/knowledge/runtime';
import { bullets, command, heading, joined, link, paragraph, subheading, text, type Block, type Inline } from '../output';
import type { Command, CommandContext } from '../types';

/*
 * The words a recruiter types: experience, education, cv, interview. Each is a
 * view over the same structured data as `about` and the projects; nothing here
 * is written separately, so it can't drift from the records.
 */

const questionLinks = (questions: readonly string[]): Block => bullets(questions.map((question) => [command(question)]));

export const experience: Command = {
  name: 'experience',
  aliases: ['work-history', 'employment', 'career'],
  summary: 'My professional experience, responsibilities and selected achievements',
  run: (_args, { kb }) => {
    const { employment } = experienceOf(kb);
    if (employment.length === 0) return { blocks: [paragraph('No professional experience is recorded yet.', 'muted')] };
    const blocks: Block[] = [heading('Experience')];
    for (const role of employment) {
      blocks.push(subheading(`${role.role}, ${role.organisation}`), paragraph(text([role.period, role.location].filter(Boolean).join(' · '), 'muted')));
      for (const project of role.projects) {
        blocks.push(
          paragraph([text('On ', 'muted'), command(project.name, `projects ${project.id}`), text(':', 'muted')]),
          bullets(project.responsibilities.map((item) => [item.text, text(` (${RESPONSIBILITY_SCOPE_LABELS[item.scope]})`, 'muted')])),
        );
      }
      const stories = uniqueStories(role.projects.flatMap(({ id }) => projectEvidence(kb, id).stories));
      if (stories.length > 0) blocks.push(subheading('Examples from this role'), bullets(stories.map((story) => [command(story.title, `stories ${story.id}`)])));
    }
    blocks.push(next([command('education'), command('soft-skills'), command('stories'), command('projects')]));
    return { blocks };
  },
};

export const education: Command = {
  name: 'education',
  aliases: ['qualifications', 'certifications', 'certs'],
  summary: 'My education and certifications, earned and in progress',
  run: (_args, { kb }) => {
    const { education: entries, certifications } = experienceOf(kb);
    const blocks: Block[] = [heading('Education')];
    if (entries.length > 0) {
      blocks.push({
        kind: 'list',
        items: entries.map((item) => ({
          lines: [
            [text(item.qualification, undefined, true)],
            [text([item.institution, item.period].filter(Boolean).join(' · '), 'muted')],
            ...(item.detail ? [[item.detail]] : []),
          ],
        })),
      });
    }
    // The dated status of the apprenticeship, as the profile records it.
    const status = kb.profile.summary.find(({ text: fact }) => /apprenticeship/i.test(fact));
    if (status) blocks.push(paragraph(text(status.text, 'muted')));
    if (certifications.earned.length > 0) {
      blocks.push(subheading(`Certifications (${certifications.earnedCount} earned)`), bullets(certifications.earned.map((cert) => [cert.name, text(cert.date ? `  ${cert.date}` : '', 'muted')])));
    }
    if (certifications.inProgress.length > 0) {
      blocks.push(subheading('Studying for'), bullets(certifications.inProgress.map((cert) => [cert.name, text('  in progress, not yet earned', 'muted')])));
    }
    const learning = kb.getStory('aws-learning');
    blocks.push(
      next([
        ...(learning ? [command('How Alex learned AWS', `stories ${learning.id}`)] : []),
        command('From finance to software', 'interests'),
        command('experience'),
      ]),
    );
    return { blocks };
  },
};

export const cv: Command = {
  name: 'cv',
  aliases: ['resume', 'résumé'],
  summary: 'A one-page professional summary',
  run: (_args, { kb, cvAvailable }) => {
    const { profile } = kb;
    const { employment, education: entries, certifications } = experienceOf(kb);
    const blocks: Block[] = [
      heading(profile.name),
      paragraph(joined([text(profile.title, 'accent'), text(profile.location, 'muted')])),
      bullets(profile.summary.map(({ text: fact }) => [fact])),
    ];
    if (employment.length > 0) {
      blocks.push(subheading('Experience'), bullets(employment.map((role) => [text(`${role.role}, ${role.organisation}`, undefined, true), text(`  ${role.period}`, 'muted')])));
    }
    if (entries.length > 0) {
      blocks.push(subheading('Education'), bullets(entries.map((item) => [item.qualification, text([item.institution, item.period].filter(Boolean).map((part) => `  ${part}`).join(' ·'), 'muted')])));
    }
    if (certifications.earned.length + certifications.inProgress.length > 0) {
      blocks.push(
        subheading('Certifications'),
        bullets([
          ...certifications.earned.map((cert): Inline[] => [cert.name, text(cert.date ? `  ${cert.date}` : '', 'muted')]),
          ...certifications.inProgress.map((cert): Inline[] => [cert.name, text('  in progress', 'muted')]),
        ]),
      );
    }
    // The CV is linked only when the deployment is configured to serve it; no file is assumed.
    const linkedIn = profile.contact.links.find(({ label }) => /linkedin/i.test(label));
    blocks.push(
      paragraph(
        cvAvailable
          ? [text('Download: ', 'muted'), link('CV (PDF)', '/api/cv')]
          : [
              text('A downloadable CV isn’t published here.', 'muted'),
              ...(linkedIn ? [text(' The full history is on ', 'muted'), link('LinkedIn', linkedIn.url), text('.', 'muted')] : []),
            ],
      ),
      next([command('experience'), command('education'), command('projects'), command('contact')]),
    );
    return { blocks };
  },
};

/**
 * The two ways into the same assistant. They differ only in framing and suggested questions: either one answers any
 * question about Alex, and both use the same knowledge and the same rules.
 */
export const INTERVIEW_MODES = {
  'first-round': {
    title: 'First Round Interview',
    purpose: 'A first-stage conversation, as with a recruiter or hiring manager: Alex’s background, experience, education, soft skills, motivation and interests. Competency questions are answered with real examples from Alex’s work.',
    topics: 'Background · experience · education · collaboration · communication · problem-solving · feedback · conflict · ambiguity · motivation · interests',
    questions: [
      'Tell me about Alex.',
      'Why did Alex become a software engineer?',
      'What are Alex’s strengths?',
      'Tell me about a time Alex resolved a disagreement.',
      'How does Alex respond to feedback?',
      'What would Alex bring to our team?',
    ],
    browse: [
      ['stories', 'stories'],
      ['soft skills', 'soft-skills'],
      ['experience', 'experience'],
      ['education', 'education'],
      ['interests', 'interests'],
    ],
  },
  technical: {
    title: 'Technical Interview',
    purpose: 'A deeper conversation about Alex’s engineering: the systems Alex built, how they work, and the decisions and trade-offs behind them.',
    topics: 'TypeScript · React and React Native · Node.js and NestJS · AWS and infrastructure · architecture · testing · performance · security · databases · AI and retrieval',
    questions: [
      'How did Alex design the live-chat system at ZIM?',
      'Explain Alex’s approach to multi-tenancy.',
      'How did Alex improve SQL performance?',
      'What technical decisions did Alex make in Operafy?',
      'How does Clash of Langs ensure fair benchmarking?',
      'How did Alex evaluate retrieval quality in Total Guess?',
    ],
    browse: [
      ['projects', 'projects'],
      ['technical skills', 'skills'],
      ['how Alex works', 'approach'],
    ],
  },
} as const;
export type InterviewMode = keyof typeof INTERVIEW_MODES;

const unavailable = (context: Pick<CommandContext, 'aiAvailable'>): Block[] =>
  context.aiAvailable ? [] : [paragraph('The AI assistant isn’t connected right now, so questions show the matching projects instead.', 'muted')];

export function interviewMode(mode: InterviewMode, context: Pick<CommandContext, 'aiAvailable'>): Block[] {
  const { title, purpose, topics, questions, browse } = INTERVIEW_MODES[mode];
  const other: InterviewMode = mode === 'technical' ? 'first-round' : 'technical';
  return [
    heading(title),
    paragraph(purpose),
    paragraph(text(topics, 'muted')),
    ...unavailable(context),
    subheading('Questions to try'),
    questionLinks(questions),
    paragraph(text('Ask your own in plain English: any question about Alex works here. Follow-ups work too, such as “Can you give me another example?”', 'muted')),
    paragraph([
      text('Browse: ', 'muted'),
      ...joined(browse.map(([label, run]) => command(label, run))),
      text(' · or switch to the ', 'muted'),
      command(INTERVIEW_MODES[other].title, other),
    ]),
  ];
}

/** What `interview` (and `ask` on its own) shows: the two modes, with a taste of each. */
export function interviewGuide(context: Pick<CommandContext, 'aiAvailable'>): Block[] {
  const blocks: Block[] = [
    heading('Interview'),
    paragraph('Ask anything about Alex in plain English, as you would in an interview. Answers come only from this portfolio, with their sources. Choose a starting point:'),
    ...unavailable(context),
  ];
  for (const mode of Object.keys(INTERVIEW_MODES) as InterviewMode[]) {
    const { title, purpose, questions } = INTERVIEW_MODES[mode];
    blocks.push(subheading(title), paragraph(text(purpose, 'muted')), questionLinks(questions.slice(0, 2)), paragraph([command(`More ${title} questions`, mode)]));
  }
  return blocks;
}

export const firstRound: Command = {
  name: 'first-round',
  aliases: ['first-round-interview', 'firstround', 'recruiter'],
  summary: 'First Round Interview: background, experience, soft skills and competency questions',
  run: (_args, context) => ({ blocks: interviewMode('first-round', context) }),
};

export const technical: Command = {
  name: 'technical',
  aliases: ['technical-interview', 'tech-interview'],
  summary: 'Technical Interview: engineering, architecture and the decisions behind it',
  run: (_args, context) => ({ blocks: interviewMode('technical', context) }),
};

export const interview: Command = {
  name: 'interview',
  aliases: ['questions'],
  summary: 'The two interviews, First Round and Technical, with questions to ask',
  run: (_args, context) => ({ blocks: interviewGuide(context) }),
};

function uniqueStories(stories: readonly Story[]): Story[] {
  return stories.filter((story, index) => stories.findIndex(({ id }) => id === story.id) === index);
}

const next = (commands: Inline[]): Block => paragraph([text('Next: ', 'muted'), ...joined(commands)]);
