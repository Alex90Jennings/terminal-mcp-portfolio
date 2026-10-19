/**
 * Local stdio transport, for Claude Desktop's local config, MCP Inspector and
 * offline development. stdout carries the protocol, so diagnostics go to stderr.
 *
 *   npm run mcp:stdio            (from the repository root)
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createKnowledgeBase } from '@portfolio/knowledge';
import bundle from '@portfolio/knowledge/bundle.json' with { type: 'json' };
import { createPortfolioServer } from './server.ts';

const server = createPortfolioServer(createKnowledgeBase(bundle), {
  onError: (error, where) => console.error(`[portfolio-mcp] ${where} failed:`, error),
});
await server.connect(new StdioServerTransport());
console.error('[portfolio-mcp] ready on stdio');
