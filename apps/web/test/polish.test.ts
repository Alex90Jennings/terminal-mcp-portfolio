import { buildBundle, createKnowledgeBase, type Evidence } from '@portfolio/knowledge';
import { readContent } from '@portfolio/knowledge/node';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { QUICK_COMMANDS } from '@/components/Terminal';
import { followUps } from '@/lib/follow-ups';
import { kb } from '@/lib/knowledge';
import { welcome } from '@/terminal/commands/session';
import { WELCOME_QUESTIONS } from '@/terminal/commands/recruiter';
import { blocksToText } from '@/terminal/output';
import { commandsIn, hrefsIn, output, run } from './helpers';

const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../content');

describe('the welcome screen frames the terminal as an interview', () => {
  const blocks = welcome({ kb });
  const text = blocksToText(blocks);

  it('says who Alex is, that this is an interactive portfolio and a first-stage interview, and that plain English works', () => {
    expect(text).toMatch(/^Alex Jennings\nFull Stack Software Developer & Cloud Engineer/);
    expect(text).toMatch(/Hi, I’m Alex\. Welcome to my interactive portfolio: think of it as a first-stage interview\./);
    expect(text).toMatch(/\[First Round Interview\] Background, experience, soft skills\n\[Technical Interview\] Engineering, architecture, trade-offs\nOr ask anything in plain English\. Try:/);
  });

  it('links both interviews (the other areas are the chips below)', () => {
    expect(commandsIn(blocks)).toEqual(expect.arrayContaining(['first-round', 'technical']));
  });

  it('offers four example questions, each run exactly as typed', () => {
    expect([...WELCOME_QUESTIONS]).toEqual(['Tell me about Alex.', 'What has Alex built?', 'Tell me about a time Alex solved a difficult problem.', 'Why should we hire Alex?']);
    for (const question of WELCOME_QUESTIONS) {
      expect(commandsIn(blocks)).toContain(question);
      // Clicking runs the link's text as input: with the assistant on, each one is a question for it.
      expect(run(question, { aiAvailable: true }).ask?.question, question).toBe(question);
    }
  });

  it('stays short: a greeting, the two interviews, then four questions (the phone fit is checked end to end)', () => {
    expect(text.split('\n')).toHaveLength(10);
  });
});

describe('navigation chips', () => {
  it('cover the primary areas, in order, each running an existing command', () => {
    expect(QUICK_COMMANDS.map(({ label }) => label)).toEqual(['First Round Interview', 'Technical Interview', 'About', 'Experience', 'Projects', 'Soft skills', 'Education', 'Interests', 'Contact']);
    for (const { command } of QUICK_COMMANDS) expect(output(command), command).not.toMatch(/command not found/);
  });
});

describe('recruiter commands', () => {
  it('experience: the role, dates, responsibilities with scope, and examples from the role', () => {
    const text = output('experience');
    expect(text).toMatch(/Software Developer, ZIM Connections Ltd\.\nOct 2022 – Oct 2026 · London, UK/);
    expect(text).toMatch(/Collaborated with another developer[^\n]*\(collaborative\)/);
    expect(text).toMatch(/Helped scale the platform[^\n]*\(team effort\)/);
    expect(commandsIn(run('experience').blocks)).toEqual(expect.arrayContaining(['star zim-live-chat', 'star zim-black-friday', 'projects zim-sbb']));
    expect(text).not.toMatch(/currently|still works/i);
  });

  it('education: qualifications, the dated apprenticeship status, and certifications earned apart from in progress', () => {
    const text = output('education');
    expect(text).toMatch(/BSc \(Hons\) Digital & Technology Solutions/);
    expect(text).toMatch(/As of the September 2026 CV, Alex was completing a software engineering degree apprenticeship/);
    expect(text).toMatch(/Certifications \(2 earned\)\nAWS Certified AI Practitioner  Mar 2026\nAWS Certified Cloud Practitioner  Apr 2026/);
    expect(text).toMatch(/Studying for\nAWS Certified Solutions Architect – Associate  in progress, not yet earned/);
    expect(text).not.toMatch(/three/i);
  });

  it('cv: a summary, and no invented download: only the published LinkedIn link', () => {
    const result = run('cv');
    expect(blocksToText(result.blocks)).toMatch(/A downloadable CV isn’t published here\. The full history is on LinkedIn\./);
    expect(hrefsIn(result.blocks)).toEqual(kb.profile.contact.links.filter(({ label }) => /linkedin/i.test(label)).map(({ url }) => url));
    expect(JSON.stringify(result.blocks)).not.toMatch(/\.pdf|\.docx|cv-alex|alex-jennings-cv/i);
  });

  it('interview: explains plain-English questions and both interviews, with questions to click', () => {
    const result = run('interview', { aiAvailable: true });
    expect(blocksToText(result.blocks)).toMatch(/^Interview\nAsk anything about Alex in plain English/);
    expect(commandsIn(result.blocks)).toEqual(expect.arrayContaining(['Tell me about Alex.', 'How did Alex design the live-chat system at ZIM?', 'first-round', 'technical']));
    expect(output('interview')).toMatch(/AI assistant isn’t connected right now/);
  });

  it('no longer matches internal notes: an unknown word only points at real content', () => {
    expect(output('cv')).not.toMatch(/command not found/);
    expect(output('xyzzy')).not.toMatch(/appears in/);
    const text = output('provenance-note-cv-word');
    expect(text).toMatch(/command not found/);
  });
});

describe('project pages', () => {
  it('lead with Alex’s role, before the description and the technology list', () => {
    const text = output('projects zim-connections');
    expect(text.indexOf("Alex's role")).toBeLessThan(text.indexOf('About the project'));
    expect(text.indexOf('About the project')).toBeLessThan(text.indexOf('Technology'));
  });

  it('label collaborative work "(collaborative)", never "(with the team)"', () => {
    const text = output('projects zim-connections');
    expect(text).toMatch(/Collaborated with another developer[^\n]*\(collaborative\)/);
    expect(text).not.toMatch(/with the team\)/);
    expect(output('projects zim-sbb')).toMatch(/Worked closely with the product team[^\n]*\(collaborative\)/);
  });

  it.each(kb.projects.map(({ id }) => id))('%s links its STAR stories and the soft skills they show', (id) => {
    const stories = kb.findStories({ project: id });
    const commands = commandsIn(run(`projects ${id}`).blocks);
    for (const story of stories) expect(commands).toContain(`star ${story.id}`);
    for (const competency of new Set(stories.flatMap((story) => story.competencies))) expect(commands).toContain(`soft-skills ${competency}`);
    if (stories.length === 0) expect(output(`projects ${id}`)).not.toMatch(/STAR examples/);
  });
});

describe('follow-ups after an answer', () => {
  const done = { status: 'done' as const };

  it('offer the full story and another example only for a story the answer told, and Alex’s role for the one project it was about', () => {
    expect(followUps({ ...done, stories: [{ id: 'zim-black-friday', title: 'Fixing the Black Friday discount problem' }], projects: [{ id: 'zim-connections', name: 'ZIM Connections' }] }, kb)).toEqual([
      { label: 'See the full STAR story', input: 'star zim-black-friday full' },
      { label: 'Another example', input: 'Can you give me another example?' },
      { label: "Alex's role on ZIM Connections", input: "What was Alex's role on ZIM Connections?" },
    ]);
  });

  it('offer nothing unrelated: no story, several projects, an unknown story, or an unfinished answer', () => {
    expect(followUps({ ...done, stories: [], projects: [{ id: 'sol', name: 'SOL' }, { id: 'operafy', name: 'Operafy' }] }, kb)).toEqual([]);
    expect(followUps({ ...done, stories: [{ id: 'invented', title: 'Invented' }], projects: [] }, kb)).toEqual([]);
    expect(followUps({ status: 'streaming', stories: [{ id: 'zim-black-friday', title: 'x' }], projects: [] }, kb)).toEqual([]);
  });
});

describe('dated figures', () => {
  it('ZIM’s brand and app-identity counts are dated to the September 2026 CV wherever they are stated as a fact', () => {
    for (const id of ['zim-connections', 'zim-sbb']) {
      const project = kb.getProject(id)!;
      const facts = [...project.overview, ...project.architecture.overview, ...project.challenges.map(({ outcome }) => ({ text: outcome ?? '' }))];
      for (const { text } of facts.filter(({ text: fact }) => /\b(4|four) (production )?brands\b/i.test(fact))) expect(text, `${id}: ${text}`).toMatch(/As of the September 2026 CV|as of the September 2026 CV/);
    }
  });
});

describe('no unpublished or private content through the new views', () => {
  it('with every story and interest back in draft, the new commands and project pages show none of them', async () => {
    const raw = await readContent(contentDir);
    const drafts = structuredClone(raw.evidence!.data) as Evidence;
    for (const item of [...drafts.stories, ...drafts.interests.personal, ...drafts.interests.technical, ...drafts.background.motivation, ...drafts.background.workingEnvironment]) {
      Object.assign(item, { status: 'needs-review', visibility: 'draft' });
    }
    const unpublished = { kb: createKnowledgeBase(buildBundle({ ...raw, evidence: { ...raw.evidence!, data: drafts } })) };
    for (const input of ['experience', 'education', 'cv', 'interview', 'projects zim-connections', 'projects sol']) {
      const text = output(input, unpublished);
      expect(text, input).not.toMatch(/Black Friday|STAR examples|Soft skills:|How Alex learned AWS/);
    }
  });
});
