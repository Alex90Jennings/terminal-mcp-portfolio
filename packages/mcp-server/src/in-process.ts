import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { KnowledgeBase } from '@portfolio/knowledge';
import { createPortfolioServer, type PortfolioServerOptions } from './server.ts';

/**
 * An official MCP client connected to a fresh portfolio server in the same
 * process: the AI assistant uses the exact tools external clients see, with no
 * network hop. Close it when done.
 */
export async function connectInProcess(kb: KnowledgeBase, options: PortfolioServerOptions = {}, clientName = 'portfolio-assistant'): Promise<Client> {
  const server = createPortfolioServer(kb, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: clientName, version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}
