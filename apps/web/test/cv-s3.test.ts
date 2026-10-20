import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Integration of the real S3 code path with AWS mocked at its boundary: the S3 client is called with exactly the
 * configured object, with credentials from the Vercel OIDC role and nothing else.
 */
// A plain function, not vi.fn: vitest's tracking of an async mock's rejected result surfaces as an unhandled error.
let reply: () => Promise<unknown> = async () => ({});
const sent: unknown[][] = [];
const send = (...args: unknown[]) => (sent.push(args), reply());
const S3Client = vi.fn(function S3Client(this: { send: typeof send }) {
  this.send = send;
});
const GetObjectCommand = vi.fn(function GetObjectCommand(this: { input: unknown }, input: unknown) {
  this.input = input;
});
const awsCredentialsProvider = vi.fn(() => 'oidc-credentials');
vi.mock('@aws-sdk/client-s3', () => ({ S3Client, GetObjectCommand }));
vi.mock('@vercel/oidc-aws-credentials-provider', () => ({ awsCredentialsProvider }));

const { fetchCvFromS3, cvConfig, createCvHandler } = await import('@/server/cv');
const config = cvConfig({ CV_S3_BUCKET: 'cv-alex-jennings', CV_AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/VercelPortfolioCVRole' })!;

describe('fetchCvFromS3', () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it('reads only the configured object, with the role’s short-lived OIDC credentials', async () => {
    const stream = new ReadableStream();
    reply = async () => ({ Body: { transformToWebStream: () => stream }, ContentLength: 114_250, ContentType: 'application/pdf' });
    const signal = new AbortController().signal;
    const object = await fetchCvFromS3(config, signal);
    expect(awsCredentialsProvider).toHaveBeenCalledWith({ roleArn: 'arn:aws:iam::123456789012:role/VercelPortfolioCVRole' });
    expect(S3Client).toHaveBeenCalledWith({ region: 'eu-west-1', credentials: 'oidc-credentials', maxAttempts: 2 });
    expect(GetObjectCommand).toHaveBeenCalledWith({ Bucket: 'cv-alex-jennings', Key: 'cv-alex-jennings.pdf' });
    expect(sent).toEqual([[expect.objectContaining({ input: { Bucket: 'cv-alex-jennings', Key: 'cv-alex-jennings.pdf' } }), { abortSignal: signal }]]);
    expect(object).toEqual({ body: stream, contentLength: 114_250, contentType: 'application/pdf' });
  });

  it('reuses the same client, and passes S3 errors on for the route to handle', async () => {
    S3Client.mockClear();
    reply = async () => {
      throw Object.assign(new Error('Access Denied'), { name: 'AccessDenied' });
    };
    const failure = await fetchCvFromS3(config, new AbortController().signal).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect((failure as Error | undefined)?.name).toBe('AccessDenied');
    expect(S3Client).not.toHaveBeenCalled();
  });
});

describe('GET /api/cv through the real S3 code path', () => {
  const log = vi.fn();
  const handle = createCvHandler({ config: () => config, fetchCv: fetchCvFromS3, log });
  const get = () => handle(new Request('https://builtbyaj.io/api/cv'));
  const pdf = new TextEncoder().encode('%PDF-1.7\n% test fixture, not a CV\n');
  const fail = (name: string, message: string) => async () => {
    throw Object.assign(new Error(message), { name, $metadata: { httpStatusCode: 403 } });
  };

  beforeEach(() => log.mockClear());

  it('downloads the PDF: streamed, as an attachment, with no AWS headers', async () => {
    reply = async () => ({
      Body: { transformToWebStream: () => new ReadableStream({ start: (c) => (c.enqueue(pdf), c.close()) }) },
      ContentLength: pdf.byteLength,
      ContentType: 'application/pdf',
      ETag: '"etag"',
      VersionId: 'v1',
    });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="cv-alex-jennings.pdf"');
    expect([...response.headers.keys()].filter((name) => /amz|etag|version/i.test(name))).toEqual([]);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdf);
  });

  it.each([
    ['a missing object (S3 reports access denied without ListBucket)', 'AccessDenied', 'Access Denied'],
    ['a missing object (NoSuchKey)', 'NoSuchKey', 'The specified key does not exist.'],
    ['an AWS service error', 'InternalError', 'We encountered an internal error. Please try again.'],
    ['STS refusing the OIDC token', 'AccessDenied', 'Not authorized to perform sts:AssumeRoleWithWebIdentity on arn:aws:iam::123456789012:role/VercelPortfolioCVRole'],
    ['an expired OIDC token', 'ExpiredTokenException', 'Token expired: current date/time must be before the expiration date/time'],
    ['no OIDC token at all (not on Vercel)', 'CredentialsProviderError', 'The x-vercel-oidc-token header is missing from the request'],
  ])('502 for %s, with nothing about AWS in the response or the log', async (_, name, message) => {
    reply = fail(name, message);
    const response = await get();
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toBe('The CV isn’t available right now. Please try again later.');
    expect(log).toHaveBeenCalledWith({ event: 'cv.unavailable', cause: name });
    expect(JSON.stringify([text, [...response.headers]])).not.toMatch(/cv-alex-jennings|arn:aws|sts:|token|specified key|internal error/i);
    expect(JSON.stringify(log.mock.calls)).not.toContain(message); // the error's name only
  });

  it('502 when S3 answers without a body', async () => {
    reply = async () => ({ ContentType: 'application/pdf' });
    expect((await get()).status).toBe(502);
  });
});
