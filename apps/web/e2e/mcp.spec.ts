import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { expect, test } from '@playwright/test';

// Protocol behaviour doesn't vary by browser; run it once.
test.skip(({ isMobile, browserName }) => isMobile || browserName !== 'chromium', 'protocol test runs once');

const endpoint = (baseURL: string | undefined) => new URL('/api/mcp', baseURL);

test('the official MCP client connects over Streamable HTTP and uses tools and resources', async ({ baseURL }) => {
  const client = new Client({ name: 'e2e', version: '1.0.0' });
  // The SDK's own types predate `exactOptionalPropertyTypes`; the transport is the official one.
  await client.connect(new StreamableHTTPClientTransport(endpoint(baseURL)) as unknown as Transport);

  expect(client.getServerVersion()?.name).toBe('alex-jennings-portfolio');
  const { tools } = await client.listTools();
  expect(tools.map(({ name }) => name)).toEqual(['list_projects', 'get_project', 'search_projects', 'get_profile', 'get_experience', 'get_skills']);

  const search = await client.callTool({ name: 'search_projects', arguments: { query: 'Docker' } });
  expect((search.structuredContent as { results: { projectId: string }[] }).results[0]?.projectId).toBe('clash-of-langs');

  const experience = await client.callTool({ name: 'get_experience', arguments: {} });
  expect(Object.keys(experience.structuredContent ?? {})).toEqual(['employment', 'education', 'certifications', 'citations']);

  const { resources } = await client.listResources();
  expect(resources).toHaveLength(9);
  const { contents } = await client.readResource({ uri: 'portfolio://projects/operafy' });
  expect(contents[0] && 'text' in contents[0] ? contents[0].text : '').toContain('## Sources');

  await client.close();
});

test('the endpoint enforces the transport rules over real HTTP', async ({ request }) => {
  const initialize = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } },
  };
  const accept = { Accept: 'application/json, text/event-stream' };

  const ok = await request.post('/api/mcp', { data: initialize, headers: { ...accept, Origin: 'https://inspector.example.org' } });
  expect(ok.status()).toBe(200);
  expect(ok.headers()['access-control-allow-origin']).toBe('https://inspector.example.org');
  expect(ok.headers()['access-control-allow-credentials']).toBeUndefined();
  expect(ok.headers()['ratelimit-limit']).toBeDefined();

  expect((await request.post('/api/mcp', { data: initialize, headers: { ...accept, Origin: 'http://evil.example.com' } })).status()).toBe(403);
  expect((await request.get('/api/mcp')).status()).toBe(405);
  expect((await request.fetch('/api/mcp', { method: 'OPTIONS', headers: { Origin: 'https://claude.ai', 'Access-Control-Request-Method': 'POST' } })).status()).toBe(204);
});
