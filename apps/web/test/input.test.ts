import { describe, expect, it } from 'vitest';
import { complete } from '@/terminal/complete';
import { looksLikeQuestion } from '@/terminal/execute';
import { browse, idleCursor, MAX_HISTORY, remember } from '@/terminal/history';
import { MAX_INPUT_LENGTH, parseInput } from '@/terminal/parse';
import { createRegistry, registry } from '@/terminal/registry';
import type { Command } from '@/terminal/types';
import { context } from './helpers';

describe('parseInput', () => {
  it.each([
    ['help', { name: 'help', args: [] }],
    ['  PROJECTS   sol  ', { name: 'projects', args: ['sol'] }],
    ['projects "clash of langs" architecture', { name: 'projects', args: ['clash of langs', 'architecture'] }],
    ["projects 'zim@sbb'", { name: 'projects', args: ['zim@sbb'] }],
    ['projects "unterminated', { name: 'projects', args: ['unterminated'] }],
    ['', { name: '', args: [] }],
  ])('parses %j', (input, expected) => {
    expect(parseInput(input)).toMatchObject(expected);
  });

  it('caps input length', () => {
    expect(parseInput('x'.repeat(MAX_INPUT_LENGTH * 2)).raw).toHaveLength(MAX_INPUT_LENGTH);
  });
});

describe('registry', () => {
  it('rejects a name registered twice', () => {
    const fake = (name: string, aliases: string[] = []): Command => ({ name, aliases, summary: '', run: () => ({ blocks: [] }) });
    expect(() => createRegistry([fake('help'), fake('assist', ['help'])])).toThrow(/registered twice/);
  });

  it('includes every agreed command', () => {
    expect(registry.commands.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['help', 'about', 'projects', 'skills', 'contact', 'clear', 'history']),
    );
  });

  it('finds commands by alias, case-insensitively', () => {
    expect(registry.find('WHOAMI')?.name).toBe('about');
    expect(registry.find('nope')).toBeUndefined();
  });
});

describe('looksLikeQuestion', () => {
  it.each(['What is your experience with AWS?', 'which project uses docker', 'tell me about sol', 'docker?', 'I like your terminal a lot'])(
    'treats %j as a question',
    (input) => expect(looksLikeQuestion(input)).toBe(true),
  );

  it.each(['projcts', 'docker', 'foo bar', ''])('treats %j as a command', (input) => expect(looksLikeQuestion(input)).toBe(false));
});

describe('complete', () => {
  const completeInput = (input: string) => complete(input, registry, context());

  it('completes a unique command name', () => {
    expect(completeInput('proj')).toEqual({ value: '/projects ', candidates: [] });
    expect(completeInput('/proj')).toEqual({ value: '/projects ', candidates: [] });
  });

  it('lists candidates when several commands match', () => {
    expect(completeInput('/a')).toEqual({ candidates: ['/about', '/approach', '/ask'] });
  });

  it('completes project ids after "projects"', () => {
    expect(completeInput('projects cl')).toEqual({ value: 'projects clash-of-langs ', candidates: [] });
    expect(completeInput('/projects cl')).toEqual({ value: '/projects clash-of-langs ', candidates: [] });
    expect(completeInput('projects zim')).toEqual({ value: 'projects zim-', candidates: ['zim-connections', 'zim-sbb'] });
  });

  it('completes sections after a project', () => {
    expect(completeInput('projects sol arch')).toEqual({ value: 'projects sol architecture ', candidates: [] });
  });

  it('offers every project after "projects "', () => {
    expect(completeInput('projects ').candidates).toHaveLength(8);
  });

  it('returns nothing when nothing matches', () => {
    expect(completeInput('xyz')).toEqual({ candidates: [] });
    expect(completeInput('help me')).toEqual({ candidates: [] });
  });
});

describe('history', () => {
  it('skips blanks and immediate repeats, and keeps the newest entries', () => {
    expect(remember(['help'], '  ')).toEqual(['help']);
    expect(remember(['help'], 'help')).toEqual(['help']);
    expect(remember(['help'], ' projects ')).toEqual(['help', 'projects']);
    const full = Array.from({ length: MAX_HISTORY }, (_, index) => `cmd ${index}`);
    expect(remember(full, 'latest')).toHaveLength(MAX_HISTORY);
    expect(remember(full, 'latest').at(-1)).toBe('latest');
  });

  it('steps back with ↑ and forward with ↓, restoring the draft at the end', () => {
    const entries = ['help', 'projects', 'about'];
    let state = { cursor: idleCursor, value: 'draft' };
    const press = (direction: -1 | 1) => (state = browse(entries, state.cursor, state.value, direction));

    expect(press(-1).value).toBe('about');
    expect(press(-1).value).toBe('projects');
    expect(press(-1).value).toBe('help');
    expect(press(-1).value).toBe('help');
    expect(press(1).value).toBe('projects');
    expect(press(1).value).toBe('about');
    expect(press(1).value).toBe('draft');
    expect(state.cursor).toEqual(idleCursor);
  });

  it('does nothing without history', () => {
    expect(browse([], idleCursor, 'typed', -1)).toEqual({ cursor: idleCursor, value: 'typed' });
  });
});
