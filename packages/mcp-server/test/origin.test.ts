import { describe, expect, it } from 'vitest';
import { checkHost, checkOrigin, corsHeaders, preflightHeaders, resolveOriginPolicy, type OriginPolicy } from '../src/http/origin.ts';

const open: OriginPolicy = { allowedOrigins: '*', allowedHosts: [] };

describe('checkOrigin (open policy)', () => {
  it('accepts requests without an Origin: desktop and CLI clients', () => {
    expect(checkOrigin(null, open)).toEqual({ ok: true, origin: null });
  });

  it.each(['https://claude.ai', 'https://inspector.example.org', 'http://localhost:6274', 'http://127.0.0.1:3000', 'http://[::1]:8080', 'HTTPS://Example.COM'])(
    'accepts %s',
    (origin) => expect(checkOrigin(origin, open).ok).toBe(true),
  );

  it.each([
    'null',
    'http://evil.example.com',
    'http://192.168.1.10:3000',
    'file:///etc/passwd',
    'chrome-extension://abcdef',
    'https://example.com/path',
    'not a url',
    '',
  ])('rejects %j', (origin) => expect(checkOrigin(origin, open).ok).toBe(false));
});

describe('checkOrigin (allow-list)', () => {
  const policy: OriginPolicy = { allowedOrigins: ['https://claude.ai'], allowedHosts: [] };

  it('accepts listed origins only', () => {
    expect(checkOrigin('https://claude.ai', policy).ok).toBe(true);
    expect(checkOrigin('https://example.com', policy).ok).toBe(false);
    expect(checkOrigin('http://localhost:3000', policy).ok).toBe(false);
  });
});

describe('checkHost', () => {
  const policy: OriginPolicy = { allowedOrigins: '*', allowedHosts: ['portfolio.example.com', '[::1]'] };

  it('accepts listed hosts with or without a port', () => {
    expect(checkHost('portfolio.example.com', policy)).toBe(true);
    expect(checkHost('Portfolio.Example.com:443', policy)).toBe(true);
    expect(checkHost('[::1]:3000', policy)).toBe(true);
  });

  it('rejects other or missing hosts (DNS rebinding)', () => {
    expect(checkHost('attacker.example', policy)).toBe(false);
    expect(checkHost(null, policy)).toBe(false);
  });

  it('is disabled when no hosts are configured', () => {
    expect(checkHost('anything', open)).toBe(true);
  });
});

describe('CORS headers', () => {
  it('echo the validated origin and never allow credentials', () => {
    const headers = { ...corsHeaders('https://claude.ai'), ...preflightHeaders('https://claude.ai') };
    expect(headers['Access-Control-Allow-Origin']).toBe('https://claude.ai');
    expect(headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
    expect(headers['Access-Control-Allow-Headers']).toContain('Mcp-Protocol-Version');
    expect(Object.keys(headers)).not.toContain('Access-Control-Allow-Credentials');
  });

  it('are omitted for requests without an Origin', () => {
    expect(corsHeaders(null)).toEqual({});
  });
});

describe('resolveOriginPolicy', () => {
  it('defaults to open origins and no host check', () => {
    expect(resolveOriginPolicy({ NODE_ENV: 'production' })).toEqual({ allowedOrigins: '*', allowedHosts: [] });
  });

  it('adds Vercel deployment hosts automatically, plus configured ones', () => {
    const policy = resolveOriginPolicy({
      NODE_ENV: 'production',
      VERCEL_URL: 'portfolio-abc123.vercel.app',
      VERCEL_PROJECT_PRODUCTION_URL: 'alexjennings.dev',
      MCP_ALLOWED_HOSTS: 'www.alexjennings.dev',
    });
    expect([...policy.allowedHosts].sort()).toEqual(['alexjennings.dev', 'portfolio-abc123.vercel.app', 'www.alexjennings.dev']);
  });

  it('allows loopback hosts only in development', () => {
    expect(resolveOriginPolicy({ NODE_ENV: 'development' }).allowedHosts).toEqual(['localhost', '127.0.0.1', '[::1]']);
  });

  it('reads an origin allow-list', () => {
    expect(resolveOriginPolicy({ MCP_ALLOWED_ORIGINS: 'https://claude.ai/, https://example.com' }).allowedOrigins).toEqual([
      'https://claude.ai',
      'https://example.com',
    ]);
  });
});
