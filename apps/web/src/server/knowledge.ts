import { createKnowledgeBase } from '@portfolio/knowledge';
import bundle from '@portfolio/knowledge/bundle.json';
import { guardPreview } from '@/lib/preview-guard';

export { guardPreview };

/** The knowledge base for server code, re-validated rather than trusted (the browser copy skips validation). */
export const serverKb = guardPreview(createKnowledgeBase(bundle), process.env);
