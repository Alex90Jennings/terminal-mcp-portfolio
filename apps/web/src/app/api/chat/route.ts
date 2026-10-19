import { chatHandler } from '@/server/ai';

/**
 * The terminal's AI assistant: POST a question (and the signed conversation so
 * far), receive the answer as server-sent events. Same-origin only.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export { chatHandler as POST };
