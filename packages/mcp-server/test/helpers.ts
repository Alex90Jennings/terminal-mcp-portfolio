import { expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createKnowledgeBase, type KnowledgeBase } from '@portfolio/knowledge';
import { loadBundle } from '@portfolio/knowledge/node';
import { createPortfolioServer, type PortfolioServerOptions } from '../src/server.ts';

const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../content');

export const kb: KnowledgeBase = createKnowledgeBase(await loadBundle(contentDir));

/** The official MCP client, connected in-process to a fresh server. */
export async function connect(options: PortfolioServerOptions = {}, knowledge: KnowledgeBase = kb): Promise<Client> {
  const server = createPortfolioServer(knowledge, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'portfolio-tests', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // Listing tools makes the client cache each outputSchema and validate every result against it.
  await client.listTools();
  return client;
}

export async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

export function structured<T = Record<string, unknown>>(result: CallToolResult): T {
  if (result.isError) throw new Error(`tool error: ${JSON.stringify(result.content)}`);
  return result.structuredContent as T;
}

export function errorText(result: CallToolResult): string {
  expect(result.isError).toBe(true);
  return result.content.map((item) => (item.type === 'text' ? item.text : '')).join('');
}

/** Every `sources` id inside a value, for attribution checks. */
export function sourceIds(value: unknown): string[] {
  const ids: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node === null || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      if (key === 'sources' && Array.isArray(child) && child.every((id) => typeof id === 'string')) ids.push(...child);
      else visit(child);
    }
  };
  visit(value);
  return ids;
}
