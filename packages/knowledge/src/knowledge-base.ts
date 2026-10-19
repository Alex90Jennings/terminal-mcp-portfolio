import { KnowledgeValidationError } from './errors.ts';
import { wrapKnowledgeBase, type KnowledgeBase } from './query.ts';
import { KnowledgeBundleSchema } from './schema.ts';

/** Validates a bundle from an untrusted or unknown origin, then wraps it in read-only queries. */
export function createKnowledgeBase(bundle: unknown): KnowledgeBase {
  const parsed = KnowledgeBundleSchema.safeParse(bundle);
  if (!parsed.success) {
    throw new KnowledgeValidationError(parsed.error.issues.map((issue) => `bundle: ${issue.path.join('.')}: ${issue.message}`));
  }
  return wrapKnowledgeBase(parsed.data);
}
