import { describe, expect, it, vi } from 'vitest';
import { listen, preferredVoice, recognitionError, recognitionIn, spokenSentences, synthesisIn, type Recognition } from '@/lib/speech';

class FakeRecognition implements Recognition {
  static last: FakeRecognition | undefined;
  lang = '';
  interimResults = false;
  continuous = true;
  onresult: Recognition['onresult'] = null;
  onerror: Recognition['onerror'] = null;
  onend: Recognition['onend'] = null;
  started = false;
  stopped = false;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
    this.onend?.();
  }
  abort() {
    this.stop();
  }
  hear(parts: { transcript: string; isFinal: boolean }[], resultIndex = 0) {
    const results = parts.map(({ transcript, isFinal }) => Object.assign([{ transcript }], { isFinal }));
    this.onresult?.({ resultIndex, results });
  }
}

const handlers = () => ({ onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onEnd: vi.fn() });

describe('support', () => {
  it('finds recognition under either name, and only offers reading aloud where utterances exist', () => {
    expect(recognitionIn({ webkitSpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
    expect(recognitionIn({ SpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
    expect(recognitionIn({})).toBeUndefined();
    const synth = {} as SpeechSynthesis;
    expect(synthesisIn({ speechSynthesis: synth, SpeechSynthesisUtterance: class {} })).toBe(synth);
    expect(synthesisIn({ speechSynthesis: synth })).toBeUndefined();
  });
});

describe('listen', () => {
  it('listens once, in British English, showing words as they come and sending the whole question at the end', () => {
    const on = handlers();
    listen(FakeRecognition, { lang: 'en-GB', ...on });
    const recognition = FakeRecognition.last!;
    expect(recognition).toMatchObject({ started: true, lang: 'en-GB', interimResults: true, continuous: false });
    recognition.hear([{ transcript: 'What has', isFinal: false }]);
    expect(on.onInterim).toHaveBeenLastCalledWith('What has');
    recognition.hear([{ transcript: 'What has Alex built', isFinal: true }]);
    expect(on.onFinal).not.toHaveBeenCalled();
    recognition.onend?.();
    expect(on.onFinal).toHaveBeenCalledWith('What has Alex built');
    expect(on.onEnd).toHaveBeenCalledOnce();
  });

  it('sends nothing when nothing was heard, and stopping early ends without a question', () => {
    const on = handlers();
    const stop = listen(FakeRecognition, { lang: 'en-GB', ...on });
    stop();
    expect(FakeRecognition.last!.stopped).toBe(true);
    expect(on.onFinal).not.toHaveBeenCalled();
    expect(on.onEnd).toHaveBeenCalledOnce();
  });

  it('explains real errors in plain words, and stays quiet about its own stop', () => {
    const on = handlers();
    listen(FakeRecognition, { lang: 'en-GB', ...on });
    FakeRecognition.last!.onerror?.({ error: 'aborted' });
    expect(on.onError).not.toHaveBeenCalled();
    FakeRecognition.last!.onerror?.({ error: 'not-allowed' });
    expect(on.onError).toHaveBeenCalledWith(recognitionError('not-allowed'));
    expect(recognitionError('not-allowed')).toMatch(/Microphone access was blocked/);
    expect(recognitionError('no-speech')).toMatch(/didn’t hear anything/);
  });
});

describe('what is read aloud', () => {
  it('drops Markdown, code marks and links, reads "/contact" as "contact", and splits into sentences', () => {
    expect(spokenSentences('Alex built **SOL**. See https://example.com for more! Use `/contact` to ask.')).toEqual(['Alex built SOL.', 'See for more!', 'Use contact to ask.']);
    expect(spokenSentences('No full stop at the end')).toEqual(['No full stop at the end']);
    expect(spokenSentences('  ')).toEqual([]);
  });

  it('prefers a British voice on the device, then any English one', () => {
    const voice = (lang: string, localService = true) => ({ lang, localService, name: lang }) as SpeechSynthesisVoice;
    expect(preferredVoice([voice('en-US'), voice('en-GB', false), voice('en-GB')], 'en-GB')).toEqual(voice('en-GB'));
    expect(preferredVoice([voice('fr-FR'), voice('en-US')], 'en-GB')).toEqual(voice('en-US'));
    expect(preferredVoice([], 'en-GB')).toBeUndefined();
  });
});
