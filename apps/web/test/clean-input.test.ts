import { describe, expect, it } from 'vitest';
import { cleanInput } from '@/lib/clean-input';
import { looksLikeQuestion } from '@/terminal/execute';
import { parseInput } from '@/terminal/parse';

describe('cleanInput: visitor text as plain data', () => {
  it.each([
    ['terminal colour codes', '\u001b[31mred\u001b[0m text', 'red text'],
    ['an OSC title or hyperlink sequence', '\u001b]0;pwned\u0007hello', 'hello'],
    ['control characters and NUL', 'a\u0000b\u0007c\u007fd', 'abcd'],
    ['C1 controls', 'x\u009by', 'xy'],
    ['bidirectional overrides that reorder text', 'abc‮dcba‬', 'abcdcba'],
    ['zero-width characters that hide text', 'pro​jects', 'projects'],
    ['a byte-order mark', '﻿about', 'about'],
    ['tabs, newlines and runs of spaces', '  what\tis\n\nSOL?  ', 'what is SOL?'],
  ])('removes %s', (_, input, expected) => {
    expect(cleanInput(input)).toBe(expected);
  });

  it('keeps what the text says: accents, emoji, other scripts and punctuation', () => {
    expect(cleanInput('Quels projets Alex a-t-il réalisés ? 🚀 ¿Qué? 日本語 <script>')).toBe('Quels projets Alex a-t-il réalisés ? 🚀 ¿Qué? 日本語 <script>');
    expect(cleanInput('é')).toBe('é');
  });

  it('is applied before a command is parsed, so hidden characters can’t disguise one', () => {
    expect(parseInput('​pro​jects so‮l').name).toBe('projects');
    expect(parseInput('\u001b[2Jclear').name).toBe('clear');
  });
});

describe('legitimate questions in other languages and typography are left exactly as written', () => {
  const QUESTIONS = [
    ['Italian', 'Quali progetti ha realizzato Alex? Perché ha scelto l’ingegneria del software?'],
    ['French', 'Qu’est-ce qu’Alex a construit chez ZIM ? Parlez-moi de « Clash of Langs ».'],
    ['Spanish', '¿Qué tecnologías usó Alex en Operafy? ¡Gracias!'],
    ['accented names', 'Did Alex work with teams in Zürich, São Paulo, Kraków or Malmö? Any résumé or café-style naïve questions?'],
    ['Unicode punctuation', 'Alex’s “live chat” — how many conversations… (as of Sept 2026) – and why • bullets?'],
    ['emoji and other scripts', 'What did Alex build? 🚀 日本語で教えてください。'],
  ] as const;

  it.each(QUESTIONS)('%s', (_, question) => {
    expect(cleanInput(question)).toBe(question);
  });

  it.each(QUESTIONS)('%s is treated as a question, not a command', (_, question) => {
    expect(looksLikeQuestion(parseInput(question).raw)).toBe(true);
  });

  it('normalises decomposed accents to their usual form, without changing the text', () => {
    expect(cleanInput('Perché Zürich?')).toBe('Perché Zürich?');
  });
});
