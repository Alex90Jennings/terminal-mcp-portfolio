import { createKnowledgeBase } from '@portfolio/knowledge';
import bundle from '@portfolio/knowledge/bundle.json';
import { createMcpHandler, createPortfolioServer, resolveOriginPolicy } from '@portfolio/mcp-server';
import { clientKey, createLimiter, parseFailureMode, type Limiter } from './rate-limit';

// Server-side, so the bundle is re-validated rather than trusted.
const kb = createKnowledgeBase(bundle);

const perMinute = Math.min(1000, Math.max(1, Number(process.env.MCP_RATE_LIMIT_PER_MINUTE) || 60));

// Created on first request, not at import, so `next build` never needs runtime secrets.
let limiter: Limiter | undefined;

export const mcpHandler = createMcpHandler({
  createServer: () =>
    createPortfolioServer(kb, {
      onError: (error, where) => console.error(JSON.stringify({ event: 'mcp.error', where, error: String(error) })),
    }),
  originPolicy: resolveOriginPolicy(process.env),
  rateLimit: async (request) => {
    limiter ??= createLimiter({
      name: 'mcp',
      requests: perMinute,
      windowSeconds: 60,
      // Read-only and free to serve, so a store outage lets requests through unless configured otherwise.
      failureMode: parseFailureMode(process.env.MCP_RATE_LIMIT_FAILURE_MODE, 'open'),
    });
    return limiter(await clientKey(request));
  },
  log: (event) => console.log(JSON.stringify({ event: 'mcp.request', ...event })),
});
