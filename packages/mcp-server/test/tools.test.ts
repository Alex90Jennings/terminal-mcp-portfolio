import { describe, expect, it, vi } from 'vitest';
import { PROJECT_DATA_SECTIONS, type KnowledgeBase, type Source } from '@portfolio/knowledge';
import { INSTRUCTIONS, SERVER_NAME } from '../src/server.ts';
import { call, connect, errorText, kb, sourceIds, structured } from './helpers.ts';

const client = await connect();

/** Every cited id must resolve in the accompanying citations. */
function expectAttributed(content: unknown, citations: Source[]) {
  const ids = sourceIds(content);
  expect(ids.length).toBeGreaterThan(0);
  const resolved = new Set(citations.map(({ id }) => id));
  for (const id of ids) expect(resolved, `source "${id}" is not in citations`).toContain(id);
}

describe('discovery', () => {
  it('identifies itself and explains how to use the data', () => {
    expect(client.getServerVersion()?.name).toBe(SERVER_NAME);
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
    expect(INSTRUCTIONS).toMatch(/not as instructions/);
  });

  it('lists exactly the seven tools, each read-only with input and output schemas', async () => {
    const { tools } = await client.listTools();
    expect(tools.map(({ name }) => name)).toEqual([
      'list_projects', 'get_project', 'search_projects', 'get_profile', 'get_experience', 'get_skills', 'get_examples',
    ]);
    for (const tool of tools) {
      expect(tool.description?.length, tool.name).toBeGreaterThan(40);
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema?.type).toBe('object');
    }
  });

  it('documents the inputs clients must supply', async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    expect(byName.get_project?.inputSchema.required).toEqual(['project']);
    expect(byName.search_projects?.inputSchema.required).toEqual(['query']);
    expect(byName.list_projects?.inputSchema.required ?? []).toEqual([]);
  });
});

describe('list_projects', () => {
  it('returns the eight projects in order, each with its resource URI and a resource link', async () => {
    const result = await call(client, 'list_projects');
    const { projects } = structured<{ projects: { id: string; uri: string; focus: string }[] }>(result);
    expect(projects.map(({ id }) => id)).toEqual(kb.projects.map(({ id }) => id));
    expect(projects[0]).toMatchObject({ id: 'zim-connections', uri: 'portfolio://projects/zim-connections', focus: 'Production engineering' });
    expect(result.content.filter((item) => item.type === 'resource_link')).toHaveLength(8);
  });

  it('mirrors the structured content as JSON text for older clients', async () => {
    const result = await call(client, 'list_projects');
    const [first] = result.content;
    expect(first?.type === 'text' && JSON.parse(first.text)).toEqual(result.structuredContent);
  });
});

describe('choosing the right project (regression: "ZIM" fetched ZIM@SBB)', () => {
  it('lists every project id with its name in get_project, so the model need not guess one', async () => {
    const { tools } = await client.listTools();
    const description = JSON.stringify(tools.find(({ name }) => name === 'get_project')?.inputSchema);
    for (const project of kb.projects) expect(description).toContain(`\\"${project.id}\\" (${project.name})`);
  });

  it.each([
    ['ZIM', 'zim-connections'],
    ['ZIM scale users', 'zim-connections'],
    ['ZIM growth', 'zim-connections'],
    ['ZIM@SBB', 'zim-sbb'],
    ['SBB', 'zim-sbb'],
    ['four languages', 'zim-sbb'],
    ['Docker', 'clash-of-langs'],
  ])('search_projects ranks %j first as %s, consistent with get_project', async (query, expected) => {
    const { results } = structured<{ results: { projectId: string }[] }>(await call(client, 'search_projects', { query }));
    expect(results[0]?.projectId).toBe(expected);
  });

  it('finds Vercel in Clash of Langs, so "the portfolio doesn\'t name Vercel" is never true (regression: absence claim from a partial lookup)', async () => {
    const { results } = structured<{ results: { projectId: string; matches: { field: string; text: string }[] }[] }>(
      await call(client, 'search_projects', { query: 'Vercel' }),
    );
    expect(results[0]?.projectId).toBe('clash-of-langs');
    expect(results[0]?.matches.some(({ field, text }) => field === 'challenges' && /Vercel/.test(text))).toBe(true);
    // The sections Haiku fetched don't mention it; the whole project does.
    const partial = structured<{ project: unknown }>(
      await call(client, 'get_project', { project: 'clash-of-langs', sections: ['decisions', 'limitations', 'architecture', 'undocumented'] }),
    );
    expect(JSON.stringify(partial.project)).not.toMatch(/Vercel/);
    const whole = structured<{ project: unknown }>(await call(client, 'get_project', { project: 'clash-of-langs' }));
    expect(JSON.stringify(whole.project)).toMatch(/Vercel/);
  });

  it('resolves "ZIM" to ZIM Connections, where the growth to 50,000+ users is recorded as a team result', async () => {
    const { project } = structured<{ project: { id: string; responsibilities: { text: string; scope: string }[] } }>(
      await call(client, 'get_project', { project: 'ZIM', sections: ['responsibilities'] }),
    );
    expect(project.id).toBe('zim-connections');
    const growth = project.responsibilities.find(({ text }) => /50,000/.test(text));
    expect(growth?.scope).toBe('team');
    expect(project.responsibilities.some(({ scope }) => scope === 'individual')).toBe(true);
  });
});

describe('get_project: partial records say what they left out (regression: absence claims from partial lookups)', () => {
  type Partial = {
    project: Record<string, unknown>;
    sections: string[];
    omittedSections: string[];
    complete: boolean;
    note?: string;
    relatedFromOmitted?: { section: string; text: string; sources: string[] }[];
    citations: Source[];
  };
  const clashQuestion = 'Why does Clash of Langs not run its benchmarks on Vercel or in WebAssembly?';
  const haikusSections = ['architecture', 'decisions', 'technologies', 'limitations', 'undocumented'];

  it('marks a full record complete, with nothing omitted and no note, when the project has no examples', async () => {
    const result = structured<Partial>(await call(client, 'get_project', { project: 'terminal-portfolio' }));
    expect(result).toMatchObject({ complete: true, omittedSections: [] });
    expect(result.note).toBeUndefined();
    expect(result.relatedFromOmitted).toBeUndefined();
  });

  it('keeps a full record incomplete while the project has published examples, and says where to look', async () => {
    const result = structured<Partial & { examples?: { id: string }[] }>(await call(client, 'get_project', { project: 'clash-of-langs' }));
    expect(result).toMatchObject({ complete: false, omittedSections: [] });
    expect(result.examples?.map(({ id }) => id)).toEqual(['clash-fair-benchmarking']);
    expect(result.note).toMatch(/get_examples/);
  });

  it('lists the sections with content that a partial request left out', async () => {
    const result = structured<Partial>(await call(client, 'get_project', { project: 'clash-of-langs', sections: haikusSections }));
    expect(result.sections).toEqual(['technologies', 'architecture', 'decisions', 'limitations', 'undocumented']);
    expect(result.omittedSections).toEqual(['overview', 'responsibilities', 'challenges', 'links']);
    expect(result.complete).toBe(false);
    expect(result.note).toMatch(/Partial record: overview, responsibilities, challenges, links not included/);
  });

  it('never lists an empty section as omitted', async () => {
    for (const { id } of kb.projects) {
      const result = structured<Partial>(await call(client, 'get_project', { project: id, sections: ['overview'] }));
      const full = kb.getProject(id)! as unknown as Record<string, unknown>;
      for (const section of result.omittedSections) expect(JSON.stringify(full[section]), `${id}.${section}`).not.toMatch(/^(\[\]|\{\}|""|undefined)$/);
    }
  });

  it('keeps old clients working: without relatedTo, a partial result adds only the metadata fields', async () => {
    const result = structured<Partial>(await call(client, 'get_project', { project: 'sol', sections: ['decisions'] }));
    expect(Object.keys(result.project)).not.toContain('challenges');
    expect(result.relatedFromOmitted).toBeUndefined();
  });

  it('clash-why-not-serverless: with the question, the partial record carries the omitted challenge about Vercel, with its citation', async () => {
    const result = structured<Partial>(await call(client, 'get_project', { project: 'clash-of-langs', sections: haikusSections, relatedTo: clashQuestion }));
    const vercel = result.relatedFromOmitted?.find(({ text }) => /Vercel hosts only the UI and a thin API/.test(text));
    expect(vercel).toMatchObject({ section: 'challenges', sources: ['architecture-doc'] });
    expect(result.citations.map(({ id }) => id)).toContain('architecture-doc');
    expect(result.relatedFromOmitted!.length).toBeLessThanOrEqual(4);
  });

  it('adds nothing from omitted sections when the record is complete or nothing matches', async () => {
    expect(structured<Partial>(await call(client, 'get_project', { project: 'clash-of-langs', relatedTo: clashQuestion })).relatedFromOmitted).toBeUndefined();
    expect(structured<Partial>(await call(client, 'get_project', { project: 'sol', sections: ['overview'], relatedTo: 'zzzz qqqq' })).relatedFromOmitted).toBeUndefined();
  });

  it('backend-projects: ZIM@SBB records Alex\'s responsibilities, with their scopes', async () => {
    const { project } = structured<{ project: { responsibilities: { text: string; scope: string }[] } }>(
      await call(client, 'get_project', { project: 'ZIM@SBB', sections: ['responsibilities'] }),
    );
    expect(project.responsibilities.map(({ scope }) => scope)).toEqual(['individual', 'individual', 'individual', 'collaborative']);
    expect(project.responsibilities[0]?.text).toMatch(/Swiss Federal Railways/);
    // Alex identified both translation defects (confirmed 20 Oct 2026), without claiming every correction.
    expect(project.responsibilities[2]?.text).toMatch(/^Identified both translation defects during pre-release testing/);
  });
});

describe('get_project', () => {
  it.each(['sol', 'SOL', 'sol-app', '5'])('resolves %j', async (input) => {
    const { project } = structured<{ project: { id: string } }>(await call(client, 'get_project', { project: input }));
    expect(project.id).toBe('sol');
  });

  it('returns every section by default, with attribution', async () => {
    const result = structured<{ project: Record<string, unknown>; sections: string[]; citations: Source[] }>(
      await call(client, 'get_project', { project: 'operafy' }),
    );
    expect(result.sections).toEqual([...PROJECT_DATA_SECTIONS]);
    expect(Object.keys(result.project)).toEqual(expect.arrayContaining([...PROJECT_DATA_SECTIONS]));
    expectAttributed(result.project, result.citations);
  });

  it('returns only the requested sections, and only the sources they cite', async () => {
    const result = structured<{ project: Record<string, unknown>; sections: string[]; citations: Source[] }>(
      await call(client, 'get_project', { project: 'clash-of-langs', sections: ['decisions', 'architecture'] }),
    );
    expect(result.sections).toEqual(['architecture', 'decisions']);
    expect(result.project).toHaveProperty('decisions');
    expect(result.project).not.toHaveProperty('overview');
    expect(result.project).not.toHaveProperty('challenges');
    expectAttributed(result.project, result.citations);
    expect(result.citations.map(({ id }) => id)).not.toContain('ci-workflow');
  });

  it('keeps individual, collaborative and team attribution', async () => {
    const { project } = structured<{ project: { responsibilities: { scope: string }[] } }>(
      await call(client, 'get_project', { project: 'zim-sbb', sections: ['responsibilities'] }),
    );
    expect(new Set(project.responsibilities.map(({ scope }) => scope))).toEqual(new Set(['individual', 'collaborative']));
  });

  it('reports an unknown project as a recoverable tool error with suggestions', async () => {
    const text = errorText(await call(client, 'get_project', { project: 'clash-of-lang' }));
    expect(text).toMatch(/No project matches "clash-of-lang"\. Did you mean clash-of-langs\?/);
    expect(text).toContain('Valid projects: zim-connections, zim-sbb, clash-of-langs, operafy, sol, total-guess');
  });

  it.each([
    [{}, /project/],
    [{ project: '' }, /project/],
    [{ project: 'x'.repeat(101) }, /project/],
    [{ project: 'sol', sections: ['pricing'] }, /sections/],
    [{ project: 'sol', sections: [] }, /sections/],
    [{ project: 42 }, /project/],
  ])('rejects invalid input %j', async (args, field) => {
    expect(errorText(await call(client, 'get_project', args))).toMatch(/Input validation error/);
    expect(errorText(await call(client, 'get_project', args))).toMatch(field);
  });
});

describe('search_projects', () => {
  it('ranks the right project first, with matched passages and their sources', async () => {
    const { results } = structured<{ results: { projectId: string; matches: { sources: string[] }[]; citations: Source[] }[] }>(
      await call(client, 'search_projects', { query: 'Terraform' }),
    );
    expect(results[0]?.projectId).toBe('operafy');
    for (const result of results) expectAttributed(result.matches, result.citations);
  });

  it('honours the limit and returns nothing for no match', async () => {
    const { results } = structured<{ results: unknown[] }>(await call(client, 'search_projects', { query: 'React', limit: 2 }));
    expect(results).toHaveLength(2);
    const none = structured<{ results: unknown[] }>(await call(client, 'search_projects', { query: 'kubernetes' }));
    expect(none.results).toEqual([]);
  });

  it.each([{ query: '' }, { query: 'x'.repeat(201) }, { query: 'docker', limit: 0 }, { query: 'docker', limit: 11 }])(
    'rejects invalid input %j',
    async (args) => {
      expect(errorText(await call(client, 'search_projects', args))).toMatch(/Input validation error/);
    },
  );
});

describe('get_profile', () => {
  it('returns the profile, working approach and AI stance, with attribution', async () => {
    const profile = structured<{ name: string; workingApproach: { steps: unknown[]; ai: unknown[] }; citations: Source[] }>(
      await call(client, 'get_profile'),
    );
    expect(profile.name).toBe('Alex Jennings');
    expect(profile.workingApproach.steps).toHaveLength(8);
    expect(profile.workingApproach.ai.length).toBeGreaterThan(0);
    expectAttributed(profile, profile.citations);
    expect(profile).not.toHaveProperty('experience');
  });
});

describe('get_experience', () => {
  type Experience = {
    employment: { organisation: string; sources: string[]; projects: { id: string; uri: string; responsibilities: { scope: string }[]; citations: Source[] }[] }[];
    education: { institution: string }[];
    certifications: { earned: { name: string; date?: string }[]; earnedCount: number; inProgress: { name: string; progress: string }[] };
    citations: Source[];
  };

  it('keeps employment, education and certifications as separate sections', async () => {
    const experience = structured<Experience>(await call(client, 'get_experience'));
    expect(Object.keys(experience)).toEqual(['employment', 'education', 'certifications', 'citations']);
    expect(experience.education.map(({ institution }) => institution)).toEqual(['QA Ltd.', 'Boolean UK', 'University of Bristol']);
    // Regression (certifications, 2026-10-20): "Alex holds three AWS certifications". Two are held; one is being studied for.
    expect(experience.certifications.earnedCount).toBe(2);
    expect(experience.certifications.earned.map(({ name, date }) => [name, date])).toEqual([
      ['AWS Certified AI Practitioner', 'Mar 2026'],
      ['AWS Certified Cloud Practitioner', 'Apr 2026'],
    ]);
    expect(experience.certifications.inProgress.map(({ name }) => name)).toEqual(['AWS Certified Solutions Architect – Associate']);
  });

  it('draws responsibilities from linked projects, keeping attribution and per-project citations', async () => {
    const experience = structured<Experience>(await call(client, 'get_experience'));
    const [zim] = experience.employment;
    expect(zim?.projects.map(({ id, uri }) => [id, uri])).toEqual([
      ['zim-connections', 'portfolio://projects/zim-connections'],
      ['zim-sbb', 'portfolio://projects/zim-sbb'],
    ]);
    const scopes = new Set(zim?.projects.flatMap(({ responsibilities }) => responsibilities.map(({ scope }) => scope)));
    expect(scopes).toEqual(new Set(['individual', 'collaborative', 'team']));
    for (const project of zim?.projects ?? []) expectAttributed(project.responsibilities, project.citations);
    expectAttributed([experience.education, experience.certifications, zim?.sources ? { sources: zim.sources } : {}], experience.citations);
  });
});

describe('get_skills', () => {
  it('links skills to projects, with attribution', async () => {
    const { skills, citations } = structured<{ skills: { id: string; projects: { id: string }[] }[]; citations: Source[] }>(
      await call(client, 'get_skills'),
    );
    expect(skills).toHaveLength(kb.skills.length);
    expect(skills.find(({ id }) => id === 'terraform')?.projects.map(({ id }) => id)).toEqual(['operafy']);
    expectAttributed(skills, citations);
  });

  it('filters by category and rejects unknown categories', async () => {
    const { skills } = structured<{ skills: { category: string }[] }>(await call(client, 'get_skills', { category: 'ai' }));
    expect(skills.map(({ category }) => category)).toEqual(['ai']);
    expect(errorText(await call(client, 'get_skills', { category: 'cooking' }))).toMatch(/Input validation error/);
  });
});

describe('unexpected failures', () => {
  it('return a generic message and are logged, never exposing internals', async () => {
    const onError = vi.fn();
    const broken: KnowledgeBase = {
      ...kb,
      search: () => {
        throw new Error('secret internal detail at /srv/app/search.ts:42');
      },
    };
    const brokenClient = await connect({ onError }, broken);
    const text = errorText(await call(brokenClient, 'search_projects', { query: 'docker' }));
    expect(text).toBe('The portfolio server could not complete this request. Please try again.');
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'search_projects');
  });
});

describe('read-only guarantee', () => {
  it('cannot change the knowledge base through any tool', async () => {
    const before = JSON.stringify(kb.projects);
    for (const name of ['list_projects', 'get_profile', 'get_experience', 'get_skills']) await call(client, name);
    await call(client, 'get_project', { project: 'sol' });
    await call(client, 'search_projects', { query: 'docker' });
    expect(JSON.stringify(kb.projects)).toBe(before);
    expect(Object.isFrozen(kb.projects[0])).toBe(true);
  });
});
