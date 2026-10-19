'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { kb } from '@/lib/knowledge';
import { welcome } from '@/terminal/commands/session';
import { complete } from '@/terminal/complete';
import { execute } from '@/terminal/execute';
import { browse, idleCursor, remember } from '@/terminal/history';
import type { Block } from '@/terminal/output';
import { MAX_INPUT_LENGTH } from '@/terminal/parse';
import { registry } from '@/terminal/registry';
import type { CommandContext } from '@/terminal/types';
import { OutputBlocks } from './OutputBlocks';

interface Entry {
  id: number;
  /** The command as typed; absent for the welcome message. */
  input?: string;
  blocks: Block[];
}

const QUICK_COMMANDS = ['help', 'projects', 'about', 'skills', 'approach', 'contact'] as const;

const user = (kb.profile.name.split(' ')[0] ?? 'guest').toLowerCase();
const PROMPT = `${user}@portfolio:~$`;

/** Touch devices: don't summon the on-screen keyboard after tapping a command. */
const isCoarsePointer = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

export function Terminal() {
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

  const context: CommandContext = useMemo(
    () => ({ kb, history, commands: registry.commands, aiAvailable: false }),
    [history],
  );

  const run = useCallback(
    (line: string, { refocus }: { refocus: boolean }) => {
      const nextHistory = remember(history, line);
      const result = execute(line, registry, { ...context, history: nextHistory });
      setHistory(nextHistory);
      setCursor(idleCursor);
      setValue('');
      setCandidates([]);
      if (result.clear) {
        setEntries([]);
        setStatus('Screen cleared.');
      } else {
        setEntries((current) => [...current, { id: nextId.current++, input: line, blocks: result.blocks }]);
        setStatus('');
      }
      if (refocus && !isCoarsePointer()) inputRef.current?.focus({ preventScroll: true });
    },
    [context, history],
  );

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
        </form>
        <p id="terminal-help" className="sr-only">
          Type help and press Enter. Tab completes, the up and down arrows step through previous commands.
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
          {QUICK_COMMANDS.map((name) => (
            <li key={name} className="shrink-0">
              <button type="button" className="term-chip" onClick={() => run(name, { refocus: true })}>
                {name}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
