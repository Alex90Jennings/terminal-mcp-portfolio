import bundle from '@portfolio/knowledge/bundle.json';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import type { NextConfig } from 'next';
import { guardPreview } from './src/lib/preview-guard';

const isDev = process.env.NODE_ENV === 'development';

// Inline scripts are allowed because Next.js hydrates with them and the page is
// statically rendered (nonces would force dynamic rendering). No third-party
// origins are allowed anywhere: fonts are self-hosted and there is no tracking.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `next dev` would otherwise write a generic AGENTS.md; this repo's guidance lives in its own docs.
  agentRules: false,
  transpilePackages: ['@portfolio/knowledge', '@portfolio/mcp-server', '@portfolio/assistant'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), interest-cohort=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

// A draft-preview knowledge bundle may only be served by `next dev`: building or
// starting with one fails here, before anything is compiled or served.
export default function config(phase: string): NextConfig {
  if (phase !== PHASE_DEVELOPMENT_SERVER) guardPreview(bundle, { ...process.env, NODE_ENV: 'production' });
  return nextConfig;
}
