import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('stdio transport', () => {
  it('starts as a child process and serves tools and resources to the official client', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', path.join(packageDir, 'src/stdio.ts')],
      cwd: packageDir,
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-test', version: '1.0.0' });
    await client.connect(transport);
    try {
      expect(client.getServerVersion()?.name).toBe('alex-jennings-portfolio');
      expect((await client.listTools()).tools.map(({ name }) => name)).toHaveLength(7);
      const result = await client.callTool({ name: 'list_projects', arguments: {} });
      expect((result.structuredContent as { projects: unknown[] }).projects).toHaveLength(8);
      expect((await client.listResources()).resources.length).toBe(11);
    } finally {
      await client.close();
    }
  }, 30_000);
});
