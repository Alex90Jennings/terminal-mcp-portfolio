/**
 * A preview knowledge bundle includes unpublished drafts for Alex's local
 * review. Only a local development server may serve one: a production build,
 * `next start` or any Vercel deployment fails closed instead of publishing
 * drafts. Shared by the server, the browser bundle and next.config.ts.
 */
export function previewRefusal(env: Record<string, string | undefined>): string | undefined {
  if (env.VERCEL === '1' || env.VERCEL_ENV !== undefined) return 'on a Vercel deployment';
  if (env.NODE_ENV === 'production') return 'in a production build or server';
  return undefined;
}

/** Takes any bundle or knowledge base; only a `preview: true` one is ever refused. */
export function guardPreview<T extends object>(kb: T, env: Record<string, string | undefined>): T {
  const refusal = 'preview' in kb && kb.preview === true ? previewRefusal(env) : undefined;
  if (refusal) throw new Error(`Refusing a preview knowledge bundle ${refusal}: rebuild it without KNOWLEDGE_PREVIEW.`);
  return kb;
}
