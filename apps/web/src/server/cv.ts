import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider';

/**
 * Alex's CV, downloaded through GET /api/cv from a private S3 bucket.
 *
 * The bucket and key are fixed by configuration, never by the visitor, so there is no way to ask for another object.
 * On Vercel the function exchanges its OIDC token for a short-lived session of a role that may only `s3:GetObject`
 * this one object: no AWS keys exist anywhere, and nothing about AWS reaches the browser. The PDF is streamed, with a
 * size cap, and its first bytes are checked before anything is sent. The CV is a download only: it is never part of
 * the knowledge the terminal, the MCP server or the assistant answer from.
 */

export const CV_FILENAME = 'cv-alex-jennings.pdf';
export const CV_ROUTE = '/api/cv';
/** A CV is well under this; anything larger is refused rather than streamed. */
export const MAX_CV_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 8_000;

export interface CvConfig {
  bucket: string;
  key: string;
  region: string;
  /** The role the Vercel deployment assumes through OIDC. */
  roleArn: string;
}

const BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/; // one object at the bucket root: no slashes, so no path traversal
const REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;
const ROLE = /^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]{1,128}$/;

/**
 * The CV's location and role, from `CV_S3_BUCKET`, `CV_S3_KEY` (default cv-alex-jennings.pdf), `CV_S3_REGION`
 * (default eu-west-1) and `CV_AWS_ROLE_ARN`. Undefined (no CV offered) unless every value is present and well formed.
 */
export function cvConfig(env: Record<string, string | undefined>): CvConfig | undefined {
  const bucket = env.CV_S3_BUCKET?.trim() ?? '';
  const key = env.CV_S3_KEY?.trim() || CV_FILENAME;
  const region = env.CV_S3_REGION?.trim() || 'eu-west-1';
  const roleArn = env.CV_AWS_ROLE_ARN?.trim() ?? '';
  if (!BUCKET.test(bucket) || bucket.includes('..') || !KEY.test(key) || key.includes('..') || !REGION.test(region) || !ROLE.test(roleArn)) return undefined;
  return { bucket, key, region, roleArn };
}

export interface CvObject {
  body: ReadableStream<Uint8Array>;
  contentLength?: number;
  contentType?: string;
}

/** Reads the configured object; an S3 or credentials error rejects. */
export type FetchCv = (config: CvConfig, signal: AbortSignal) => Promise<CvObject>;

let client: { roleArn: string; region: string; s3: S3Client } | undefined;

/** S3 with the role's short-lived credentials only: never the default credential chain, never stored keys. */
export const fetchCvFromS3: FetchCv = async (config, signal) => {
  if (client?.roleArn !== config.roleArn || client.region !== config.region) {
    client = { roleArn: config.roleArn, region: config.region, s3: new S3Client({ region: config.region, credentials: awsCredentialsProvider({ roleArn: config.roleArn }), maxAttempts: 2 }) };
  }
  const object = await client.s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: config.key }), { abortSignal: signal });
  if (object.Body === undefined) throw new Error('empty body');
  return {
    body: object.Body.transformToWebStream() as ReadableStream<Uint8Array>,
    ...(object.ContentLength !== undefined && { contentLength: object.ContentLength }),
    ...(object.ContentType !== undefined && { contentType: object.ContentType }),
  };
};

export interface CvDeps {
  config: () => CvConfig | undefined;
  fetchCv: FetchCv;
  log?: (event: Record<string, unknown>) => void;
}

const UNAVAILABLE = 'The CV isn’t available right now. Please try again later.';
const plain = (status: number, text: string, headers: Record<string, string> = {}) =>
  new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

export function createCvHandler(deps: CvDeps): (request: Request) => Promise<Response> {
  const log = deps.log ?? ((event) => console.log(JSON.stringify(event)));
  // Errors are logged by name and status only: never a bucket, key, ARN or message.
  const fail = (cause: string) => (log({ event: 'cv.unavailable', cause }), plain(502, UNAVAILABLE));

  return async (request) => {
    if (request.method !== 'GET') return plain(405, 'Use GET.', { Allow: 'GET' });
    const config = deps.config();
    if (config === undefined) return plain(404, 'No CV is published.');

    let object: CvObject;
    try {
      object = await deps.fetchCv(config, AbortSignal.timeout(TIMEOUT_MS));
    } catch (error) {
      return fail(error instanceof Error ? error.name : 'error');
    }
    const cancel = () => object.body.cancel().catch(() => {});
    if (object.contentLength !== undefined && object.contentLength > MAX_CV_BYTES) return (await cancel(), fail('too-large'));
    if (object.contentType !== undefined && !object.contentType.startsWith('application/pdf')) return (await cancel(), fail('not-pdf'));

    // Read only the first chunk, to check it is a PDF before answering; the rest is streamed through.
    const reader = object.body.getReader();
    let first: Uint8Array | undefined;
    try {
      const read = await reader.read();
      first = read.value;
    } catch (error) {
      return fail(error instanceof Error ? error.name : 'error');
    }
    if (first === undefined || first.byteLength < 5 || new TextDecoder().decode(first.subarray(0, 5)) !== '%PDF-') {
      await reader.cancel().catch(() => {});
      return fail('not-pdf');
    }

    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        sent = first.byteLength;
        controller.enqueue(first);
      },
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) return controller.close();
          sent += value.byteLength;
          // A cap on what is streamed, whatever S3 reported: never unbounded.
          if (sent > MAX_CV_BYTES) {
            await reader.cancel().catch(() => {});
            log({ event: 'cv.unavailable', cause: 'too-large' });
            return controller.error(new Error('CV too large'));
          }
          controller.enqueue(value);
        } catch (error) {
          log({ event: 'cv.unavailable', cause: error instanceof Error ? error.name : 'error' });
          controller.error(error);
        }
      },
      cancel: () => reader.cancel().catch(() => {}),
    });

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${CV_FILENAME}"`,
        ...(object.contentLength !== undefined && { 'Content-Length': String(object.contentLength) }),
        'Cache-Control': 'private, max-age=0, must-revalidate',
        'X-Robots-Tag': 'noindex',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  };
}

export const cvHandler = createCvHandler({ config: () => cvConfig(process.env), fetchCv: fetchCvFromS3 });
