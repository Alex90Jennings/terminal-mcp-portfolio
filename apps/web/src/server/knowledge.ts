import { createKnowledgeBase } from '@portfolio/knowledge';
import bundle from '@portfolio/knowledge/bundle.json';

/** The knowledge base for server code, re-validated rather than trusted (the browser copy skips validation). */
export const serverKb = createKnowledgeBase(bundle);
