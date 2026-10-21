'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react';
import { applyChatEvent, isActive, waitingAnswer, type AiAnswer } from '@/lib/ai-answer';
import { ChatRefused, streamChat, type Conversation } from '@/lib/chat-client';
import { kb } from '@/lib/knowledge';
import { welcome } from '@/terminal/commands/session';
import { complete } from '@/terminal/complete';
import { execute } from '@/terminal/execute';
import { browse, idleCursor, remember } from '@/terminal/history';
import type { Block } from '@/terminal/output';
import { cleanInput } from '@/lib/clean-input';
import { listen, recognitionIn, speak, synthesisIn } from '@/lib/speech';
import { MAX_INPUT_LENGTH } from '@/terminal/parse';
import { registry } from '@/terminal/registry';
import type { CommandContext } from '@/terminal/types';
import { AiAnswerView } from './AiAnswerView';
import { OutputBlocks } from './OutputBlocks';

interface Entry {
  id: number;
  /** The command as typed; absent for the welcome message. */
  input?: string;
  blocks: Block[];
  /** Set when the input was a question for the AI assistant. */
  answer?: AiAnswer;
}

/** The primary navigation: each chip runs an ordinary command, labelled in plain words. */
export const QUICK_COMMANDS = [
  { label: 'First Round Interview', command: '/first-round', primary: true },
  { label: 'Technical Interview', command: '/technical', primary: true },
  { label: 'About', command: '/about', primary: false },
  { label: 'Experience', command: '/experience', primary: false },
  { label: 'Projects', command: '/projects', primary: false },
  { label: 'Soft skills', command: '/soft-skills', primary: false },
  { label: 'Education', command: '/education', primary: false },
  { label: 'Interests', command: '/interests', primary: false },
  { label: 'Contact', command: '/contact', primary: false },
] as const;

const user = (kb.profile.name.split(' ')[0] ?? 'guest').toLowerCase();
const PROMPT = `${user}@portfolio:~$`;

/** The site's language, for recognising and reading English as spoken in the UK. */
const SPEECH_LANG = 'en-GB';
const LISTENING_NOTE = 'Listening… Your browser’s speech service (Google in Chrome, Apple in Safari) turns your voice into text.';

/** Browser support for voice doesn't change while the page is open. */
const noSubscription = () => () => {};

/** Touch devices: don't summon the on-screen keyboard after tapping a command. */
const isCoarsePointer = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

export function Terminal({ aiEnabled = false, cvAvailable = false }: { aiEnabled?: boolean; cvAvailable?: boolean }) {
  const [entries, setEntries] = useState<Entry[]>(() => [{ id: 0, blocks: welcome({ kb }) }]);
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(idleCursor);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const nextId = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastEntryRef = useRef<HTMLDivElement>(null);
  // The signed conversation so far: only the server's copy, sent back with each question.
  const conversationRef = useRef<Conversation | undefined>(undefined);
  const askingRef = useRef<{ id: number; controller: AbortController } | undefined>(undefined);
  // Voice, where the browser supports it: found after mounting, so the server render never differs from the first client one.
  const recognition = useSyncExternalStore(noSubscription, () => recognitionIn(window), () => undefined);
  const canReadAloud = useSyncExternalStore(noSubscription, () => synthesisIn(window) !== undefined, () => false);
  const synthRef = useRef<SpeechSynthesis | undefined>(undefined);
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState('');
  const [speakingId, setSpeakingId] = useState<number | undefined>(undefined);
  const stopListeningRef = useRef<(() => void) | undefined>(undefined);
  const runRef = useRef<(typed: string, options: { refocus: boolean; spoken?: boolean }) => void>(() => {});

  useEffect(() => {
    synthRef.current = synthesisIn(window);
    return () => {
      stopListeningRef.current?.();
      synthRef.current?.cancel();
    };
  }, []);

  const readAloud = useCallback((id: number, text: string) => {
    const synth = synthRef.current;
    if (synth === undefined) return;
    setSpeakingId(id);
    speak(synth, text, { lang: SPEECH_LANG, onEnd: () => setSpeakingId((current) => (current === id ? undefined : current)) });
  }, []);

  /** Stops reading aloud; true if something was being read. */
  const stopReading = useCallback(() => {
    if (synthRef.current?.speaking !== true && synthRef.current?.pending !== true) return false;
    synthRef.current.cancel();
    setSpeakingId(undefined);
    return true;
  }, []);

  /** Stops listening; true if the microphone was on. */
  const stopListening = useCallback(() => {
    const stop = stopListeningRef.current;
    if (stop === undefined) return false;
    stop();
    return true;
  }, []);

  const context: CommandContext = useMemo(
    () => ({ kb, history, commands: registry.commands, aiAvailable: aiEnabled, cvAvailable }),
    [history, aiEnabled, cvAvailable],
  );

  const updateAnswer = useCallback((id: number, update: (answer: AiAnswer) => AiAnswer) => {
    setEntries((current) => current.map((entry) => (entry.id === id && entry.answer ? { ...entry, answer: update(entry.answer) } : entry)));
  }, []);

  const cancelAnswer = useCallback(() => {
    const asking = askingRef.current;
    if (asking === undefined) return false;
    asking.controller.abort();
    askingRef.current = undefined;
    updateAnswer(asking.id, (answer) => (isActive(answer) ? { ...answer, status: 'cancelled' } : answer));
    return true;
  }, [updateAnswer]);

  const ask = useCallback(
    async (id: number, question: string, spoken: boolean) => {
      cancelAnswer();
      stopReading();
      const controller = new AbortController();
      askingRef.current = { id, controller };
      setStatus('');
      try {
        await streamChat({
          question,
          conversation: conversationRef.current,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'done') {
              conversationRef.current = event.conversation;
              if (event.answer) setStatus(`Answer: ${event.answer}`);
              // A question asked by voice is answered by voice too.
              if (spoken && event.answer) readAloud(id, event.answer);
            }
            updateAnswer(id, (answer) => applyChatEvent(answer, event));
          },
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof ChatRefused ? error.message : 'The AI assistant couldn’t answer that. Please try again.';
        updateAnswer(id, (answer) => ({ ...answer, status: 'unavailable', message }));
        setStatus(message);
      } finally {
        if (askingRef.current?.controller === controller) askingRef.current = undefined;
      }
    },
    [cancelAnswer, readAloud, stopReading, updateAnswer],
  );

  const run = useCallback(
    (typed: string, { refocus, spoken = false }: { refocus: boolean; spoken?: boolean }) => {
      // Shown, remembered and run as cleaned text, so escape or bidirectional characters can't disguise it.
      const line = cleanInput(typed);
      const nextHistory = remember(history, line);
      const result = execute(line, registry, { ...context, history: nextHistory });
      setHistory(nextHistory);
      setCursor(idleCursor);
      setValue('');
      setCandidates([]);
      setVoiceNote('');
      if (result.clear) {
        cancelAnswer();
        stopReading();
        conversationRef.current = undefined;
        setEntries([]);
        setStatus('Screen cleared.');
      } else if (result.ask) {
        const id = nextId.current++;
        setEntries((current) => [...current, { id, input: line, blocks: [], answer: waitingAnswer(result.ask?.fallback ?? []) }]);
        void ask(id, result.ask.question, spoken);
      } else {
        setEntries((current) => [...current, { id: nextId.current++, input: line, blocks: result.blocks }]);
        setStatus('');
      }
      if (refocus && !isCoarsePointer()) inputRef.current?.focus({ preventScroll: true });
    },
    [ask, cancelAnswer, context, history, stopReading],
  );
  useLayoutEffect(() => {
    runRef.current = run;
  }, [run]);

  const toggleListening = () => {
    if (recognition === undefined) return;
    if (stopListening()) return;
    stopReading();
    setValue('');
    setCandidates([]);
    setListening(true);
    setVoiceNote(LISTENING_NOTE);
    setStatus('Listening.');
    stopListeningRef.current = listen(recognition, {
      lang: SPEECH_LANG,
      onInterim: setValue,
      onFinal: (question) => runRef.current(question, { refocus: true, spoken: true }),
      onError: (message) => {
        setVoiceNote(message);
        setStatus(message);
      },
      onEnd: () => {
        stopListeningRef.current = undefined;
        setListening(false);
        setVoiceNote((note) => (note === LISTENING_NOTE ? '' : note));
      },
    });
  };

  // Long output scrolls to its first line, so it reads from the top; short output keeps the prompt in view.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    const last = lastEntryRef.current;
    if (container === null) return;
    if (last !== null && last.offsetHeight > container.clientHeight * 0.8) {
      container.scrollTop += last.getBoundingClientRect().top - container.getBoundingClientRect().top - 12;
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, [entries]);

  // Ready to type on desktop, like a real terminal. Phones wait for a tap, so the keyboard doesn't cover the page.
  useEffect(() => {
    if (!isCoarsePointer()) inputRef.current?.focus({ preventScroll: true });
  }, []);

  // Keep the prompt visible when the on-screen keyboard resizes the viewport.
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const keepPromptVisible = () => {
      if (document.activeElement === inputRef.current) inputRef.current?.scrollIntoView({ block: 'nearest' });
    };
    viewport.addEventListener('resize', keepPromptVisible);
    return () => viewport.removeEventListener('resize', keepPromptVisible);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = browse(history, cursor, value, event.key === 'ArrowUp' ? -1 : 1);
      setCursor(next.cursor);
      setValue(next.value);
      return;
    }
    if (event.key === 'Tab' && !event.shiftKey && value.trim() !== '') {
      const completion = complete(value, registry, context);
      // With nothing to complete, Tab keeps its usual job of moving focus.
      if (completion.value === undefined && completion.candidates.length === 0) return;
      event.preventDefault();
      if (completion.value !== undefined) setValue(completion.value);
      setCandidates(completion.candidates);
      return;
    }
    if (event.key === 'Escape' && value !== '') {
      event.preventDefault();
      setValue('');
      setCandidates([]);
      return;
    }
    // Esc or Ctrl+C on an empty prompt stops an answer that is still coming in, reading aloud and listening.
    if ((event.key === 'Escape' || (event.ctrlKey && event.key.toLowerCase() === 'c')) && value === '') {
      const stopped = [cancelAnswer(), stopReading(), stopListening()];
      if (stopped.some(Boolean)) {
        event.preventDefault();
        setStatus(stopped[0] ? 'Answer stopped.' : 'Stopped.');
        return;
      }
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      setEntries([]);
      setStatus('Screen cleared.');
      return;
    }
    const input = event.currentTarget;
    if (event.ctrlKey && event.key.toLowerCase() === 'c' && value !== '' && input.selectionStart === input.selectionEnd) {
      event.preventDefault();
      setEntries((current) => [...current, { id: nextId.current++, input: `${value}^C`, blocks: [] }]);
      setValue('');
      setCandidates([]);
    }
  };

  const applyCandidate = (candidate: string) => {
    const words = value.trimStart().split(/\s+/);
    if (!/\s$/.test(value)) words.pop();
    setValue(`${[...words.filter(Boolean), candidate].join(' ')} `);
    setCandidates([]);
    inputRef.current?.focus();
  };

  const focusPrompt = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('a, button, input') !== null || window.getSelection()?.toString()) return;
    inputRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-term-bg sm:rounded-xl sm:border sm:border-term-border sm:shadow-2xl">
      <div className="relative flex h-9 shrink-0 items-center justify-center border-b border-term-border bg-term-chrome px-4">
        <div aria-hidden="true" className="absolute left-4 flex gap-2">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </div>
        <p className="text-sm text-term-muted">{user}@portfolio: ~</p>
      </div>

      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- mouse convenience only; the input is the keyboard target */}
      <div ref={scrollRef} className="term-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6" onClick={focusPrompt}>
        <div role="log" aria-live="polite" aria-relevant="additions" aria-label="Terminal output" className="space-y-4">
          {entries.map((entry, index) => (
            <div key={entry.id} ref={index === entries.length - 1 ? lastEntryRef : undefined} className="space-y-1.5">
              {entry.input !== undefined && (
                <p className="break-words">
                  <span aria-hidden="true" className="text-term-accent">{PROMPT} </span>
                  <span className="sr-only">You ran: </span>
                  {entry.input}
                </p>
              )}
              <OutputBlocks blocks={entry.blocks} onCommand={(command) => run(command, { refocus: true })} />
              {entry.answer && (
                <AiAnswerView
                  answer={entry.answer}
                  onCommand={(command) => run(command, { refocus: true })}
                  {...(canReadAloud && {
                    reading: {
                      active: speakingId === entry.id,
                      toggle: () => (speakingId === entry.id ? stopReading() : readAloud(entry.id, entry.answer?.text ?? '')),
                    },
                  })}
                />
              )}
            </div>
          ))}
        </div>

        <form
          className="mt-4 flex items-baseline gap-2 rounded-sm focus-within:bg-white/[0.03]"
          onSubmit={(event) => {
            event.preventDefault();
            run(value, { refocus: true });
          }}
        >
          <label htmlFor="terminal-input" className="shrink-0 text-term-accent">
            <span aria-hidden="true">{PROMPT}</span>
            <span className="sr-only">Command</span>
          </label>
          <input
            ref={inputRef}
            id="terminal-input"
            name="command"
            type="text"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setCandidates([]);
            }}
            onKeyDown={onKeyDown}
            maxLength={MAX_INPUT_LENGTH}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            aria-describedby="terminal-help"
            className="term-input min-w-0 flex-1 bg-transparent text-term-text caret-term-accent outline-none"
          />
          {aiEnabled && recognition !== undefined && (
            <button
              type="button"
              className="term-mic self-center"
              aria-label={listening ? 'Stop listening' : 'Ask by voice'}
              aria-pressed={listening}
              title={listening ? 'Stop listening' : 'Ask by voice'}
              onClick={toggleListening}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </button>
          )}
        </form>
        {voiceNote && <p className="mt-1 text-sm text-term-muted">{voiceNote}</p>}
        <p id="terminal-help" className="sr-only">
          Type /help and press Enter, or ask a question in plain English. Tab completes, the up and down arrows step through previous commands.
        </p>

        <div role="status" aria-live="polite" className="mt-2 text-term-muted">
          {candidates.length > 0 && (
            <p className="flex flex-wrap gap-x-4">
              <span className="sr-only">{candidates.length} matches: </span>
              {candidates.map((candidate) => (
                <button key={candidate} type="button" className="term-command" onClick={() => applyCandidate(candidate)}>
                  {candidate}
                </button>
              ))}
            </p>
          )}
          {status && <span className="sr-only">{status}</span>}
        </div>
      </div>

      <nav aria-label="Quick commands" className="shrink-0 border-t border-term-border bg-term-chrome px-2 py-1.5 sm:px-4">
        {/* eslint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops list semantics when list-style is none */}
        <ul className="flex gap-1 overflow-x-auto sm:flex-wrap sm:overflow-visible" role="list">
          {QUICK_COMMANDS.map(({ label, command, primary }) => (
            <li key={command} className="shrink-0">
              <button type="button" className={primary ? 'term-chip term-chip-primary' : 'term-chip'} onClick={() => run(command, { refocus: true })}>
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
