import bundle from '@portfolio/knowledge/bundle.json';
import { wrapKnowledgeBase, type KnowledgeBundle } from '@portfolio/knowledge/runtime';
import { guardPreview } from './preview-guard';

/**
 * The verified knowledge base, generated from `content/` by `npm run knowledge:build`
 * (run automatically before `dev` and `build`). Validated when it was generated.
 * `NODE_ENV` is inlined at build time, so a production browser bundle refuses drafts too.
 */
export const kb = wrapKnowledgeBase(guardPreview(bundle as unknown as KnowledgeBundle, { NODE_ENV: process.env.NODE_ENV }));
