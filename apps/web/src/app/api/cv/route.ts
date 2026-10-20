import { cvHandler } from '@/server/cv';

/**
 * Alex's CV as a PDF download, streamed from a private S3 bucket with short-lived OIDC credentials (src/server/cv.ts).
 * 404 when the deployment isn't configured with one.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export { cvHandler as GET };
