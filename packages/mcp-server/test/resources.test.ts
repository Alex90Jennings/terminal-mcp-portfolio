import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { RESOURCE_NOT_FOUND } from '../src/resources.ts';
import { connect, kb } from './helpers.ts';

const client = await connect();

const read = async (uri: string) => {
  const { contents } = await client.readResource({ uri });
  const [content] = contents;
  if (content === undefined || !('text' in content)) throw new Error(`no text for ${uri}`);
  return content;
};

describe('resource discovery', () => {
  it('lists the profile, skills, project index and one document per project', async () => {
    const { resources } = await client.listResources();
    expect(resources.map(({ uri }) => uri)).toEqual([
      'portfolio://profile',
      'portfolio://skills',
      'portfolio://projects',
      ...kb.projects.map(({ id }) => `portfolio://projects/${id}`),
    ]);
    for (const resource of resources) expect(resource.mimeType).toBe('text/markdown');
  });

  it('publishes the project template', async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates).toEqual([expect.objectContaining({ uriTemplate: 'portfolio://projects/{id}', mimeType: 'text/markdown' })]);
  });

  it('completes project ids for the template', async () => {
    const { completion } = await client.complete({
      ref: { type: 'ref/resource', uri: 'portfolio://projects/{id}' },
      argument: { name: 'id', value: 'zim' },
    });
    expect(completion.values).toEqual(['zim-connections', 'zim-sbb']);
  });
});

describe('project documents', () => {
  it.each(kb.projects.map(({ id }) => id))('portfolio://projects/%s is complete, footnoted Markdown', async (id) => {
    const project = kb.getProject(id);
    const content = await read(`portfolio://projects/${id}`);
    expect(content.mimeType).toBe('text/markdown');
    expect(content.text).toMatch(new RegExp(`^# ${project?.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
    for (const fact of project?.overview ?? []) expect(content.text).toContain(fact.text);
    // Every claim's footnote is defined in the Sources section.
    const cited = new Set([...content.text.matchAll(/\[\^([a-z0-9-]+)\](?!:)/g)].map((match) => match[1]));
    const defined = new Set([...content.text.matchAll(/^\[\^([a-z0-9-]+)\]:/gm)].map((match) => match[1]));
    expect(cited.size).toBeGreaterThan(0);
    expect(defined).toEqual(cited);
  });

  it('labels responsibilities with their scope', async () => {
    const { text } = await read('portfolio://projects/zim-connections');
    expect(text).toContain('*(own work)*');
    expect(text).toContain('*(team effort)*');
  });

  it('includes architecture diagrams as Mermaid, decisions with rationale, and known gaps', async () => {
    const { text } = await read('portfolio://projects/clash-of-langs');
    expect(text).toContain('```mermaid\nflowchart LR');
    expect(text).toContain('**Why:**');
    expect(text).toContain('## Not documented yet');
  });

  it('links sources that have URLs', async () => {
    const { text } = await read('portfolio://projects/total-guess');
    expect(text).toContain('[^retrieval-doc]: [docs/retrieval.md](https://github.com/Alex90Jennings/total-guess/blob/main/packages/ingestion/docs/retrieval.md)');
  });

  it.each(['portfolio://projects/nope', 'portfolio://projects/sol-app', 'portfolio://projects/5'])(
    'answers %s with resource-not-found (canonical ids only)',
    async (uri) => {
      const error = await client.readResource({ uri }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(McpError);
      expect((error as McpError).code).toBe(RESOURCE_NOT_FOUND);
    },
  );
});

describe('profile, skills and index', () => {
  it('profile covers employment, education, certifications and the working approach, footnoted', async () => {
    const { text } = await read('portfolio://profile');
    for (const heading of ['## Employment', '## Education', '## Certifications', '## How I work', '### On AI', '## Sources']) {
      expect(text).toContain(heading);
    }
    expect(text).toContain('QA Ltd.');
    expect(text).not.toMatch(/\+44|07\d{3}/);
  });

  it('skills link to project documents', async () => {
    const { text } = await read('portfolio://skills');
    expect(text).toContain('**Terraform**: [Operafy](portfolio://projects/operafy)');
  });

  it('the index lists all seven projects', async () => {
    const { text } = await read('portfolio://projects');
    for (const project of kb.projects) expect(text).toContain(`[${project.name}](portfolio://projects/${project.id})`);
  });
});
