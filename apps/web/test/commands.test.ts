import { describe, expect, it } from 'vitest';
import { kb } from '@/lib/knowledge';
import { blocksToText } from '@/terminal/output';
import { registry } from '@/terminal/registry';
import { commandsIn, hrefsIn, output, run } from './helpers';

describe('help', () => {
  it('lists every registered command with its summary', () => {
    const text = output('help');
    for (const command of registry.commands) {
      expect(text).toContain(command.usage ?? command.name);
      expect(text).toContain(command.summary);
    }
  });

  it('says plainly that AI answers are unavailable', () => {
    expect(output('help')).toMatch(/once the AI assistant is connected/);
    expect(output('help', { aiAvailable: true })).toMatch(/Ask about my work in plain English/);
  });
});

describe('projects', () => {
  it('lists all six projects with their focus and tags, in order', () => {
    const text = output('projects');
    kb.projects.forEach((project, index) => {
      expect(text).toContain(`[${index + 1}] ${project.name}`);
      expect(text).toContain(project.focus);
      expect(text).toContain(project.listingTags.join(' · '));
    });
  });

  it('makes each listed project a command that opens it', () => {
    const commands = commandsIn(run('projects').blocks);
    for (const project of kb.projects) expect(commands).toContain(`projects ${project.id}`);
  });

  it.each([
    ['projects zim', 'ZIM Connections'],
    ['projects zim-sbb', 'ZIM@SBB'],
    ['projects clash-of-langs', 'Clash of Langs'],
    ['projects operafy', 'Operafy'],
    ['projects sol', 'SOL'],
    ['projects total-guess', 'Total Guess'],
  ])('%s opens %s', (input, name) => {
    expect(run(input).blocks[0]).toEqual({ kind: 'heading', text: name });
  });

  it.each([
    'project sol',
    'ls sol',
    'projects SOL',
    'projects 5',
    'projects sol-app',
    'sol',
    '5',
    'PROJECTS sol',
  ])('%s behaves exactly like "projects sol"', (input) => {
    expect(run(input)).toEqual(run('projects sol'));
  });

  it('accepts multi-word names with or without quotes', () => {
    expect(run('projects clash of langs')).toEqual(run('projects clash-of-langs'));
    expect(run('projects "Clash of Langs"')).toEqual(run('projects clash-of-langs'));
    expect(run('projects ZIM@SBB')).toEqual(run('projects zim-sbb'));
  });

  it('shows overview, role, technology and links by default', () => {
    const project = kb.getProject('operafy');
    const text = output('projects operafy');
    expect(text).toContain(project?.tagline);
    expect(text).toContain('My role');
    expect(text).toContain('Terraform');
    expect(hrefsIn(run('projects operafy').blocks)).toEqual(project?.links.map(({ url }) => url));
  });

  it('labels whose work each responsibility was', () => {
    const text = output('projects zim');
    expect(text).toMatch(/\(own work\)/);
    expect(text).toMatch(/\(team effort\)/);
  });

  it.each(['architecture', 'challenges', 'decisions', 'lessons', 'sources', 'all', 'arch'])(
    'renders the %s section',
    (section) => {
      const result = run(`projects clash-of-langs ${section}`);
      expect(result.blocks[0]).toEqual({ kind: 'heading', text: 'Clash of Langs' });
      expect(blocksToText(result.blocks)).not.toMatch(/No \w+ are documented/);
    },
  );

  it('says when a section has nothing documented, instead of inventing it', () => {
    expect(output('projects clash-of-langs lessons')).toContain('Known limitations');
    expect(output('projects sol sources')).toContain('Not documented yet');
  });

  it('offers the other sections as commands', () => {
    const commands = commandsIn(run('projects sol').blocks);
    expect(commands).toEqual(expect.arrayContaining(['projects sol architecture', 'projects sol sources']));
  });

  it('rejects an unknown section and lists the valid ones', () => {
    const result = run('projects sol pricing');
    expect(blocksToText(result.blocks)).toContain('Unknown section "pricing"');
    expect(commandsIn(result.blocks)).toContain('projects sol architecture');
  });

  it.each(['projects 0', 'projects 7', 'projects kubernetes'])('reports %s as not found and lists the projects', (input) => {
    const result = run(input);
    expect(blocksToText(result.blocks)).toMatch(/^No project called/);
    expect(commandsIn(result.blocks)).toEqual(kb.projects.map(({ id }) => `projects ${id}`));
  });

  it('suggests the closest project for a typo', () => {
    expect(commandsIn(run('projects clash-of-lang').blocks)[0]).toBe('projects clash-of-langs');
  });
});

describe('profile commands', () => {
  it('about shows the profile from the knowledge base', () => {
    const text = output('whoami');
    expect(text).toContain(kb.profile.name);
    expect(text).toContain(kb.profile.title);
    for (const { text: fact } of kb.profile.summary) expect(text).toContain(fact);
    expect(text).toContain('QA Ltd.');
  });

  it('skills links each skill to the projects that demonstrate it', () => {
    const result = run('skills');
    const text = blocksToText(result.blocks);
    for (const skill of kb.skills) expect(text).toContain(skill.name);
    expect(commandsIn(result.blocks)).toContain('projects operafy');
  });

  it('approach shows the working loop and the stance on AI', () => {
    const text = output('ai');
    for (const step of kb.profile.workingApproach?.steps ?? []) expect(text).toContain(step.title);
    expect(text).toContain('On AI');
  });

  it('contact links email, GitHub and LinkedIn, and nothing else', () => {
    const hrefs = hrefsIn(run('contact').blocks);
    expect(hrefs).toEqual([`mailto:${kb.profile.contact.email}`, ...kb.profile.contact.links.map(({ url }) => url)]);
    expect(output('contact')).not.toMatch(/\+44|07\d{3}/);
  });
});

describe('session commands', () => {
  it('history lists previous commands, each runnable', () => {
    const result = run('history', { history: ['help', 'projects sol', 'history'] });
    expect(commandsIn(result.blocks)).toEqual(['help', 'projects sol', 'history']);
  });

  it('history says when there is nothing yet', () => {
    expect(output('history')).toBe('No commands yet.');
  });

  it.each(['clear', 'cls'])('%s clears the screen', (input) => {
    expect(run(input)).toEqual({ blocks: [], clear: true });
  });
});

describe('unknown input', () => {
  it('suggests the closest command', () => {
    const result = run('projcts');
    expect(blocksToText(result.blocks)).toMatch(/^command not found: projcts/);
    expect(commandsIn(result.blocks)).toContain('projects');
  });

  it('points a bare technology at the projects that mention it', () => {
    expect(commandsIn(run('terraform').blocks)).toContain('projects operafy');
  });

  it('never executes anything: shell syntax is just an unknown command', () => {
    for (const input of ['rm -rf /', '$(whoami)', '`ls`', 'cat /etc/passwd', '<script>alert(1)</script>']) {
      expect(blocksToText(run(input).blocks)).toMatch(/command not found|AI assistant isn’t available/);
    }
  });

  it('ignores blank input', () => {
    expect(run('   ')).toEqual({ blocks: [] });
  });
});

describe('natural-language questions without AI', () => {
  it('explains that AI is unavailable and offers matching projects', () => {
    const result = run('Which project best demonstrates Docker?');
    expect(blocksToText(result.blocks)).toMatch(/AI assistant isn’t available/);
    expect(commandsIn(result.blocks)[0]).toBe('projects clash-of-langs');
  });

  it.each([
    'What is your experience with AWS?',
    'Tell me about your React Native experience.',
    'How did you approach accessibility in SOL?',
    'explain the architecture of clash of langs',
  ])('handles %j without errors', (question) => {
    expect(blocksToText(run(question).blocks)).toMatch(/AI assistant isn’t available/);
  });
});
