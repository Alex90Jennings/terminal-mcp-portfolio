import { mcpHandler } from '@/server/mcp';

/**
 * The public MCP endpoint (Streamable HTTP, stateless). POST carries JSON-RPC;
 * OPTIONS answers CORS preflights; GET and DELETE return 405 because there are
 * no sessions or server-initiated streams.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export { mcpHandler as POST, mcpHandler as GET, mcpHandler as DELETE, mcpHandler as OPTIONS };
