import bundle from '@portfolio/knowledge/bundle.json';
import { wrapKnowledgeBase, type KnowledgeBundle } from '@portfolio/knowledge/runtime';

/**
 * The verified knowledge base, generated from `content/` by `npm run knowledge:build`
 * (run automatically before `dev` and `build`). Validated when it was generated.
 */
export const kb = wrapKnowledgeBase(bundle as unknown as KnowledgeBundle);
