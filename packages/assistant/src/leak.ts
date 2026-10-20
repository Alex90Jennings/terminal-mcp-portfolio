import { SYSTEM_PROMPT } from './prompt.ts';

/*
 * The leak check: a structural backstop, so keeping instructions and secrets
 * private doesn't rest on the prompt alone. A sentence is withheld when it
 * reproduces the system prompt (any run of SHINGLE consecutive words) or looks
 * like a credential or names one of the application's secret settings. The
 * model never receives secrets, so the second rule should never fire; it
 * exists in case one ever reaches the context by mistake.
 *
 * It catches verbatim and lightly reformatted copying, not a paraphrase: the
 * prompt asks the model never to reveal or paraphrase its instructions, and a
 * paraphrase of these rules contains nothing private.
 */

const SHINGLE = 8;
const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

const promptShingles = (() => {
  const all = words(SYSTEM_PROMPT);
  const shingles = new Set<string>();
  for (let index = 0; index + SHINGLE <= all.length; index++) shingles.add(all.slice(index, index + SHINGLE).join(' '));
  return shingles;
})();

/** Credential formats and the names of the application's secret settings. */
const SECRET = new RegExp(
  [
    String.raw`\bsk-ant-[\w-]{8,}`,
    String.raw`\bA(?:KI|SI)A[0-9A-Z]{16}\b`,
    String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----`,
    String.raw`\b(?:ANTHROPIC_API_KEY|UPSTASH_REDIS_REST_TOKEN|UPSTASH_REDIS_REST_URL|CHAT_TRANSCRIPT_SECRET|AI_BEDROCK_ROLE_ARN|AWS_SECRET_ACCESS_KEY)\b`,
  ].join('|'),
);

export type LeakKind = 'instructions' | 'secret';

/** Why a sentence must not be shown, or undefined when it may be. */
export function leakIn(sentence: string): LeakKind | undefined {
  if (SECRET.test(sentence)) return 'secret';
  const said = words(sentence);
  for (let index = 0; index + SHINGLE <= said.length; index++) {
    if (promptShingles.has(said.slice(index, index + SHINGLE).join(' '))) return 'instructions';
  }
  return undefined;
}
