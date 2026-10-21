import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OutputBlocks } from '@/components/OutputBlocks';
import { Terminal } from '@/components/Terminal';
import { kb } from '@/lib/knowledge';
import { run } from './helpers';

const render = (input: string) => renderToStaticMarkup(<OutputBlocks blocks={run(input).blocks} onCommand={() => {}} />);

describe('OutputBlocks', () => {
  it('opens external links safely in a new tab and says so', () => {
    const html = render('/projects clash-of-langs');
    expect(html).toContain('href="https://clash-of-langs.vercel.app" class="term-link" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('<span class="sr-only"> (opens in a new tab)</span>');
  });

  it('keeps mailto links in the same tab', () => {
    expect(render('/contact')).toMatch(/<a href="mailto:[^"]+" class="term-link">/);
  });

  it('renders command links as buttons', () => {
    expect(render('/projects')).toContain('<button type="button" class="term-command" title="Run “/projects sol”">SOL</button>');
  });

  it('uses headings and lists for structure', () => {
    const html = render('/projects sol');
    expect(html).toMatch(/<h2[^>]*>SOL<\/h2>/);
    expect(html).toMatch(/<h3[^>]*>Alex’s role<\/h3>|<h3[^>]*>Alex&#x27;s role<\/h3>/);
    expect(html).toContain('<ul class="space-y-1" role="list">');
  });

  it('escapes content rather than injecting it', () => {
    expect(render('<img src=x onerror=alert(1)>')).not.toContain('<img');
  });
});

describe('Terminal', () => {
  const html = renderToStaticMarkup(<Terminal />);

  it('server-renders the welcome banner from the profile', () => {
    expect(html).toContain(`>${kb.profile.name}</h1>`);
    expect(html).toContain(kb.profile.title.replaceAll('&', '&amp;'));
  });

  it('labels the prompt, the output log and the quick commands', () => {
    expect(html).toMatch(/<label for="terminal-input"/);
    expect(html).toMatch(/role="log" aria-live="polite"/);
    expect(html).toContain('aria-label="Quick commands"');
  });
});

describe('content stays in the knowledge base', () => {
  it('no project text is hard-coded in the frontend', async () => {
    const sourceDir = path.resolve(import.meta.dirname, '../src');
    const files = (await readdir(sourceDir, { recursive: true })).filter((file) => /\.(ts|tsx)$/.test(file));
    const source = (await Promise.all(files.map((file) => readFile(path.join(sourceDir, file), 'utf8')))).join('\n');
    for (const project of kb.projects) {
      for (const phrase of [project.tagline, project.focus, ...project.overview.map(({ text }) => text)]) {
        expect(source, `${project.id}: "${phrase}"`).not.toContain(phrase);
      }
    }
  });
});
