import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { guardPreview, previewRefusal } from '@/lib/preview-guard';

const preview = { preview: true };
const published = { preview: false };

describe('the preview guard', () => {
  it.each([
    ['a Vercel deployment', { VERCEL: '1' }],
    ['a Vercel preview deployment', { VERCEL_ENV: 'preview' }],
    ['Vercel production', { VERCEL_ENV: 'production' }],
    ['a production build or server', { NODE_ENV: 'production' }],
  ])('refuses a preview bundle on %s', (_, env) => {
    expect(previewRefusal(env)).toBeDefined();
    expect(() => guardPreview(preview, env)).toThrow(/Refusing a preview knowledge bundle/);
  });

  it('allows a preview bundle only in local development or tests', () => {
    expect(guardPreview(preview, { NODE_ENV: 'development' })).toBe(preview);
    expect(guardPreview(preview, { NODE_ENV: 'test' })).toBe(preview);
  });

  it('never stands in the way of the published bundle', () => {
    expect(guardPreview(published, { NODE_ENV: 'production', VERCEL: '1' })).toBe(published);
    expect(guardPreview({}, { NODE_ENV: 'production' })).toEqual({});
  });
});

describe('next.config.ts', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@portfolio/knowledge/bundle.json');
  });

  async function configWith(bundle: object) {
    vi.resetModules();
    vi.doMock('@portfolio/knowledge/bundle.json', () => ({ default: bundle }));
    return (await import('../next.config')).default;
  }

  it('refuses to build or start with a preview bundle, and allows only the dev server', async () => {
    const config = await configWith(preview);
    expect(() => config(PHASE_PRODUCTION_BUILD)).toThrow(/Refusing a preview knowledge bundle/);
    expect(() => config(PHASE_PRODUCTION_SERVER)).toThrow(/Refusing a preview knowledge bundle/);
    expect(config(PHASE_DEVELOPMENT_SERVER).reactStrictMode).toBe(true);
  });

  it('builds normally with the published bundle', async () => {
    const config = await configWith(published);
    expect(config(PHASE_PRODUCTION_BUILD).poweredByHeader).toBe(false);
  });
});

describe('the browser knowledge base', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@portfolio/knowledge/bundle.json');
    vi.unstubAllEnvs();
  });

  it('refuses a preview bundle in a production browser bundle', async () => {
    vi.resetModules();
    vi.doMock('@portfolio/knowledge/bundle.json', async () => ({ default: { ...(await vi.importActual<{ default: object }>('@portfolio/knowledge/bundle.json')).default, preview: true } }));
    vi.stubEnv('NODE_ENV', 'production');
    await expect(import('@/lib/knowledge')).rejects.toThrow(/Refusing a preview knowledge bundle/);
  });

  it('serves the published bundle', async () => {
    const { kb } = await import('@/lib/knowledge');
    expect(kb.preview).toBe(false);
  });
});
