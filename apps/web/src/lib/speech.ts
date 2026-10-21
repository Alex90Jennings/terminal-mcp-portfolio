/**
 * Voice in and out, with the browser's own Web Speech API: no service, key or cost of ours. Speech recognition is
 * missing in some browsers (Firefox), so callers check `recognitionIn` and hide the microphone when it is undefined.
 * Kept free of React so the terminal and its tests share it.
 */

/** The parts of the Web Speech API the terminal uses; TypeScript's DOM types don't include recognition yet. */
export interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type RecognitionConstructor = new () => Recognition;

type SpeechWindow = { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor; speechSynthesis?: SpeechSynthesis };

export const recognitionIn = (win: object): RecognitionConstructor | undefined => (win as SpeechWindow).SpeechRecognition ?? (win as SpeechWindow).webkitSpeechRecognition;

export const synthesisIn = (win: object): SpeechSynthesis | undefined =>
  typeof (win as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance === 'function' ? (win as SpeechWindow).speechSynthesis : undefined;

/** Why listening stopped without a question, in words a visitor can act on. */
export function recognitionError(error: string): string {
  if (error === 'not-allowed' || error === 'service-not-allowed') return 'Microphone access was blocked. Allow it in your browser’s site settings to ask by voice.';
  if (error === 'no-speech') return 'I didn’t hear anything. Press the microphone and try again.';
  if (error === 'audio-capture') return 'No microphone was found.';
  if (error === 'network') return 'Your browser’s speech service couldn’t be reached. Please type your question instead.';
  return 'Voice input stopped. Please try again, or type your question.';
}

/**
 * Listens for one question. Words appear through `onInterim` as they are recognised; `onFinal` gets the whole
 * question once the visitor stops speaking. Returns a function that stops listening early.
 */
export function listen(
  Ctor: RecognitionConstructor,
  { lang, onInterim, onFinal, onError, onEnd }: { lang: string; onInterim: (text: string) => void; onFinal: (text: string) => void; onError: (message: string) => void; onEnd: () => void },
): () => void {
  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.interimResults = true;
  recognition.continuous = false;
  let final = '';
  recognition.onresult = (event) => {
    let interim = '';
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index]!;
      if (result.isFinal) final += result[0]?.transcript ?? '';
      else interim += result[0]?.transcript ?? '';
    }
    onInterim(`${final}${interim}`.trim());
  };
  recognition.onerror = (event) => {
    // "aborted" is our own stop; anything else is worth telling the visitor.
    if (event.error !== 'aborted') onError(recognitionError(event.error));
  };
  recognition.onend = () => {
    const question = final.trim();
    if (question !== '') onFinal(question);
    onEnd();
  };
  recognition.start();
  return () => recognition.stop();
}

/**
 * The answer as it should sound: no Markdown, code marks or URLs, and "/contact" read as "contact". Split into
 * sentences, because some browsers cut a long utterance off after about fifteen seconds.
 */
export function spokenSentences(text: string): string[] {
  const plain = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[`*_#>]/g, '')
    .replace(/(^|\s)\/([a-z][\w-]*)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
  return plain === '' ? [] : (plain.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [plain]).map((sentence) => sentence.trim()).filter(Boolean);
}

/** A British English voice if the device has one, matching the site, else the browser's default for the language. */
export function preferredVoice(voices: readonly SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | undefined {
  const sameLanguage = voices.filter((voice) => voice.lang.replace('_', '-').toLowerCase() === lang.toLowerCase());
  return sameLanguage.find((voice) => voice.localService) ?? sameLanguage[0] ?? voices.find((voice) => voice.lang.toLowerCase().startsWith('en'));
}

/** Reads text aloud, replacing anything already being read. `onEnd` runs once, when it finishes or is cancelled. */
export function speak(synth: SpeechSynthesis, text: string, { lang, onEnd }: { lang: string; onEnd: () => void }): void {
  synth.cancel();
  const sentences = spokenSentences(text);
  if (sentences.length === 0) return onEnd();
  const voice = preferredVoice(synth.getVoices(), lang);
  let ended = false;
  const finish = () => {
    if (!ended) {
      ended = true;
      onEnd();
    }
  };
  sentences.forEach((sentence, index) => {
    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.lang = lang;
    if (voice !== undefined) utterance.voice = voice;
    utterance.onerror = finish;
    if (index === sentences.length - 1) utterance.onend = finish;
    synth.speak(utterance);
  });
}
