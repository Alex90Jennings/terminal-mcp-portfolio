/*
 * The conversation lives in the browser, as plain text turns. The server signs
 * every transcript it returns and only accepts history it signed itself, so a
 * visitor can't put words in the assistant's mouth.
 *
 * The signature covers the version, the issue time and every turn, in order:
 * editing, reordering, dropping or adding any turn, or changing the time,
 * breaks it. Transcripts expire, so an old one can't be replayed indefinitely.
 * Even a valid transcript is conversational context only: the chat loop never
 * treats it as evidence for a fact.
 */

export interface TranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface SignedTranscript {
  turns: TranscriptTurn[];
  /** Milliseconds since the epoch when the server signed it. */
  issuedAt: number;
  signature: string;
}

export const TRANSCRIPT_LIMITS = {
  /** Six question-and-answer exchanges. */
  maxTurns: 12,
  maxTurnChars: 4_000,
  maxTotalChars: 12_000,
  /** A transcript older than this is treated as expired. */
  maxAgeMs: 24 * 60 * 60 * 1000,
  /** Tolerance for clock differences when checking that a transcript isn't from the future. */
  clockSkewMs: 60 * 1000,
} as const;

const VERSION = 'v1';
const encoder = new TextEncoder();

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** The exact bytes signed: version, issue time and the ordered turns, unambiguously encoded. */
const canonical = (turns: readonly TranscriptTurn[], issuedAt: number) =>
  encoder.encode(JSON.stringify([VERSION, issuedAt, turns.map(({ role, text }) => [role, text])]));

export async function signTranscript(turns: readonly TranscriptTurn[], secret: string, issuedAt: number): Promise<SignedTranscript> {
  const signature = await crypto.subtle.sign('HMAC', await key(secret), canonical(turns, issuedAt));
  return { turns: [...turns], issuedAt, signature: `${VERSION}.${Buffer.from(signature).toString('base64url')}` };
}

export type TranscriptCheck = { ok: true } | { ok: false; reason: 'signature' | 'expired' | 'future' };

/** Constant-time verification of a transcript produced by `signTranscript`, plus its age. */
export async function verifyTranscript(transcript: SignedTranscript, secret: string, now: number): Promise<TranscriptCheck> {
  const [version, encoded] = transcript.signature.split('.');
  if (version !== VERSION || !encoded) return { ok: false, reason: 'signature' };
  const valid = await crypto.subtle.verify('HMAC', await key(secret), Buffer.from(encoded, 'base64url'), canonical(transcript.turns, transcript.issuedAt));
  if (!valid) return { ok: false, reason: 'signature' };
  if (transcript.issuedAt > now + TRANSCRIPT_LIMITS.clockSkewMs) return { ok: false, reason: 'future' };
  if (now - transcript.issuedAt > TRANSCRIPT_LIMITS.maxAgeMs) return { ok: false, reason: 'expired' };
  return { ok: true };
}

/** Keeps the most recent whole exchanges that fit the limits, dropping the oldest first. */
export function trimTranscript(turns: readonly TranscriptTurn[]): TranscriptTurn[] {
  const kept = turns.slice(-TRANSCRIPT_LIMITS.maxTurns).map((turn) => ({ ...turn, text: turn.text.slice(0, TRANSCRIPT_LIMITS.maxTurnChars) }));
  while (kept.length > 0 && (kept[0]?.role !== 'user' || kept.reduce((sum, turn) => sum + turn.text.length, 0) > TRANSCRIPT_LIMITS.maxTotalChars)) {
    kept.splice(0, kept[0]?.role === 'user' ? 2 : 1);
  }
  return kept;
}
