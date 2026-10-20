import { readContent } from '@portfolio/knowledge/node';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { QUICK_COMMANDS } from '@/components/Terminal';
import { kb } from '@/lib/knowledge';
import { createCvHandler, cvConfig, MAX_CV_BYTES, type CvConfig, type CvObject } from '@/server/cv';
import { INTERVIEW_MODES } from '@/terminal/commands/recruiter';
import { welcome } from '@/terminal/commands/session';
import { blocksToText } from '@/terminal/output';
import { commandsIn, hrefsIn, output, run } from './helpers';

const ENV = { CV_S3_BUCKET: 'cv-alex-jennings', CV_AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/VercelPortfolioCVRole' };
const CONFIG: CvConfig = { bucket: 'cv-alex-jennings', key: 'cv-alex-jennings.pdf', region: 'eu-west-1', roleArn: ENV.CV_AWS_ROLE_ARN };
const encode = (text: string) => new TextEncoder().encode(text);
const PDF = encode('%PDF-1.7\n% test fixture, not a CV\n');

/** A body that yields these chunks, recording whether it was cancelled. */
function body(chunks: Uint8Array[]) {
  const state = { cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.shift();
      if (next === undefined) controller.close();
      else controller.enqueue(next);
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}
const handlerFor = (object: CvObject | (() => Promise<CvObject>), options: { unconfigured?: boolean } = {}) => {
  const log = vi.fn();
  const fetchCv = vi.fn(typeof object === 'function' ? object : async () => object);
  return { handle: createCvHandler({ config: () => (options.unconfigured ? undefined : CONFIG), fetchCv, log }), log, fetchCv };
};
const get = (url = 'https://portfolio.example.com/api/cv', method = 'GET') => new Request(url, { method });

describe('CV configuration: one fixed object, never chosen by the visitor', () => {
  it('needs the bucket and the OIDC role; key and region default', () => {
    expect(cvConfig(ENV)).toEqual(CONFIG);
    expect(cvConfig({ ...ENV, CV_S3_REGION: 'eu-west-2', CV_S3_KEY: 'cv.pdf' })).toMatchObject({ region: 'eu-west-2', key: 'cv.pdf' });
    expect(cvConfig({})).toBeUndefined();
    expect(cvConfig({ CV_S3_BUCKET: 'cv-alex-jennings' })).toBeUndefined();
  });

  it.each([
    ['a key with a path', { CV_S3_KEY: 'private/other.pdf' }],
    ['path traversal', { CV_S3_KEY: '../secrets.pdf' }],
    ['a dotted traversal key', { CV_S3_KEY: 'cv..pdf' }],
    ['an invalid bucket', { CV_S3_BUCKET: 'CV_Bucket!' }],
    ['an s3:// URL as the bucket', { CV_S3_BUCKET: 's3://cv-alex-jennings' }],
    ['an invalid region', { CV_S3_REGION: 'europe' }],
    ['a malformed role', { CV_AWS_ROLE_ARN: 'portfolio-cv-role' }],
  ])('offers no CV for %s', (_, override) => {
    expect(cvConfig({ ...ENV, ...override })).toBeUndefined();
  });
});

describe('GET /api/cv', () => {
  it('streams the PDF as a download, with this site’s headers and none of S3’s', async () => {
    const { stream } = body([PDF.slice(0, 9), PDF.slice(9)]);
    const { handle, fetchCv } = handlerFor({ body: stream, contentLength: PDF.byteLength, contentType: 'application/pdf' });
    const response = await handle(get('https://portfolio.example.com/api/cv?key=../other.pdf&bucket=elsewhere'));
    expect(response.status).toBe(200);
    // The visitor's query string is ignored: the configured object is the only one ever read.
    expect(fetchCv).toHaveBeenCalledWith(CONFIG, expect.any(AbortSignal));
    expect(Object.fromEntries(response.headers)).toEqual({
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="cv-alex-jennings.pdf"',
      'content-length': String(PDF.byteLength),
      'cache-control': 'private, max-age=0, must-revalidate',
      'x-robots-tag': 'noindex',
      'x-content-type-options': 'nosniff',
    });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
  });

  it('streams rather than buffering: the response starts before S3 has sent the whole file', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(PDF);
      },
      async pull(controller) {
        await gate;
        controller.enqueue(encode('rest of the file'));
        controller.close();
      },
    });
    const response = await handlerFor({ body: stream, contentType: 'application/pdf' }).handle(get());
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    expect((await reader.read()).value).toEqual(PDF);
    release();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('rest of the file');
  });

  it('404 when the deployment has no CV configured; 405 for anything but GET', async () => {
    expect((await handlerFor({ body: body([PDF]).stream }, { unconfigured: true }).handle(get())).status).toBe(404);
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) expect((await handlerFor({ body: body([PDF]).stream }).handle(get(undefined, method))).status, method).toBe(405);
  });

  it.each([
    ['access denied by S3', async () => { throw Object.assign(new Error('Access Denied for arn:aws:s3:::cv-alex-jennings/cv-alex-jennings.pdf'), { name: 'AccessDenied' }); }, 'AccessDenied'],
    ['a missing object', async () => { throw Object.assign(new Error('The specified key does not exist: cv-alex-jennings.pdf'), { name: 'NoSuchKey' }); }, 'NoSuchKey'],
    ['no OIDC credentials', async () => { throw Object.assign(new Error('Could not load credentials for arn:aws:iam::123456789012:role/x'), { name: 'CredentialsProviderError' }); }, 'CredentialsProviderError'],
    ['a timeout', async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); }, 'TimeoutError'],
  ])('502 for %s, revealing no bucket, key, ARN or message', async (_, fail, cause) => {
    const { handle, log } = handlerFor(fail as () => Promise<CvObject>);
    const response = await handle(get());
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toBe('The CV isn’t available right now. Please try again later.');
    expect(log).toHaveBeenCalledWith({ event: 'cv.unavailable', cause });
    expect(JSON.stringify([text, log.mock.calls])).not.toMatch(/cv-alex-jennings|arn:aws|Access Denied|specified key/);
  });

  it('refuses what isn’t a PDF, or is too large, and cancels the S3 stream', async () => {
    for (const [object, cause] of [
      // Each fixture has more to send, so cancelling it is observable.
      [{ ...body([encode('<html>not a cv</html>'), PDF, PDF]), contentType: 'application/pdf' }, 'not-pdf'],
      [{ ...body([PDF, PDF, PDF]), contentType: 'text/html' }, 'not-pdf'],
      [{ ...body([PDF, PDF, PDF]), contentType: 'application/pdf', contentLength: MAX_CV_BYTES + 1 }, 'too-large'],
    ] as const) {
      const { stream, state } = object;
      const { handle, log } = handlerFor({ body: stream, contentType: object.contentType, ...('contentLength' in object && { contentLength: object.contentLength }) });
      expect((await handle(get())).status).toBe(502);
      expect(log).toHaveBeenCalledWith({ event: 'cv.unavailable', cause });
      expect(state.cancelled).toBe(true);
    }
  });

  it('stops a stream that runs past the size cap even if S3 didn’t report a length', async () => {
    const chunk = new Uint8Array(4 * 1024 * 1024);
    const { stream, state } = body([PDF, chunk, chunk, chunk, chunk, chunk]);
    const { handle, log } = handlerFor({ body: stream, contentType: 'application/pdf' });
    const response = await handle(get());
    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).rejects.toThrow();
    expect(state.cancelled).toBe(true);
    expect(log).toHaveBeenCalledWith({ event: 'cv.unavailable', cause: 'too-large' });
  });
  it('ends the download with an error, logged by name only, if S3 fails partway through', async () => {
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) return (sent = true), controller.enqueue(PDF);
        controller.error(Object.assign(new Error('socket hang up from cv-alex-jennings.s3.eu-west-1.amazonaws.com'), { name: 'ECONNRESET' }));
      },
    });
    const { handle, log } = handlerFor({ body: stream, contentType: 'application/pdf' });
    const response = await handle(get());
    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).rejects.toThrow();
    expect(log).toHaveBeenCalledWith({ event: 'cv.unavailable', cause: 'ECONNRESET' });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/amazonaws|cv-alex-jennings/);
  });
});

describe('the CV is never knowledge', () => {
  it('the knowledge has no CV content or storage details', async () => {
    const content = await readContent(path.resolve(import.meta.dirname, '../../../content'));
    expect(JSON.stringify(content)).not.toMatch(/%PDF|amazonaws|s3:\/\/|cv-alex-jennings\.pdf/);
  });

  it('cv links /api/cv only when the deployment serves a CV, and keeps the summary otherwise', () => {
    const result = run('cv', { cvAvailable: true });
    expect(hrefsIn(result.blocks)).toEqual(expect.arrayContaining(['/api/cv']));
    expect(blocksToText(result.blocks)).toMatch(/Download: CV \(PDF\)/);
    expect(JSON.stringify(result.blocks)).not.toMatch(/amazonaws|s3:\/\/|cv-alex-jennings\.s3/);
    expect(output('cv')).toMatch(/A downloadable CV isn’t published here/);
  });
});

describe('the two interview modes', () => {
  it('are the navigation chips, named consistently, alongside the other areas', () => {
    expect(QUICK_COMMANDS.map(({ label }) => label)).toEqual(['First Round Interview', 'Technical Interview', 'About', 'Experience', 'Projects', 'Soft skills', 'Education', 'Interests', 'Contact']);
    expect(QUICK_COMMANDS.filter(({ primary }) => primary).map(({ label }) => label)).toEqual(['First Round Interview', 'Technical Interview']);
    expect(QUICK_COMMANDS.find(({ label }) => label === 'First Round Interview')?.command).toBe('first-round');
    expect(QUICK_COMMANDS.find(({ label }) => label === 'Technical Interview')?.command).toBe('technical');
  });

  it.each([
    ['first-round', 'First Round Interview', 'Tell me about a time Alex resolved a disagreement.'],
    ['technical', 'Technical Interview', 'How did Alex improve SQL performance?'],
  ] as const)('%s: says what it offers, with questions that run as typed, and links to the other mode', (command, title, question) => {
    const result = run(command, { aiAvailable: true });
    const text = blocksToText(result.blocks);
    expect(text.startsWith(title)).toBe(true);
    expect(text).toMatch(/any question about Alex works here/);
    expect(commandsIn(result.blocks)).toEqual(expect.arrayContaining([...INTERVIEW_MODES[command].questions]));
    expect(run(question, { aiAvailable: true }).ask?.question).toBe(question);
    expect(commandsIn(result.blocks)).toContain(command === 'technical' ? 'first-round' : 'technical');
  });

  it('keep star and ask working: star lists the stories; ask alone introduces both interviews', () => {
    expect(output('star')).toMatch(/^Stories/);
    const guide = output('ask', { aiAvailable: true });
    expect(guide).toMatch(/^Interview/);
    expect(guide).toMatch(/First Round Interview[\s\S]*Technical Interview/);
    expect(output('interview')).toBe(output('ask'));
  });

  it('are the welcome screen’s main actions, ahead of the example questions, and named in help', () => {
    const blocks = welcome({ kb });
    const actions = blocks.find((block) => block.kind === 'actions');
    expect(actions).toEqual({
      kind: 'actions',
      label: 'Choose an interview',
      items: [
        { title: 'First Round Interview', detail: 'Background, experience, soft skills', command: 'first-round' },
        { title: 'Technical Interview', detail: 'Engineering, architecture, trade-offs', command: 'technical' },
      ],
    });
    expect(blocks.indexOf(actions!)).toBeLessThan(blocks.findIndex((block) => block.kind === 'list'));
    expect(blocksToText(blocks)).toMatch(/Or ask anything in plain English\. Try:/);
    const help = output('help');
    expect(help).toMatch(/first-round {2}First Round Interview: background, experience, soft skills and STAR questions/);
    expect(help).toMatch(/technical {2}Technical Interview: engineering, architecture and the decisions behind it/);
    expect(help).toMatch(/star \[story\] \[full\] {2}STAR stories/);
  });
});
