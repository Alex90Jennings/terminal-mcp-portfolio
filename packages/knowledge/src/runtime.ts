/** Browser-safe entry point: queries over an already-validated bundle, without zod. */
export type * from './schema.ts';
export { wrapKnowledgeBase, editDistance, type KnowledgeBase } from './query.ts';
export { tokenise, type SearchHit, type SearchMatch, type SearchField } from './search.ts';
