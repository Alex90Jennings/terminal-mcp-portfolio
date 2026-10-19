import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = await readFile(path.resolve(import.meta.dirname, '../src/app/globals.css'), 'utf8');
const token = (name: string): string => {
  const match = new RegExp(`--color-term-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css);
  if (!match?.[1]) throw new Error(`missing colour token ${name}`);
  return match[1];
};

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};

describe('theme contrast (WCAG 2.2)', () => {
  it.each(['bg', 'chrome'])('every text colour reaches AAA (7:1) on %s', (background) => {
    for (const foreground of ['text', 'muted', 'accent', 'error']) {
      expect(contrast(token(foreground), token(background)), `${foreground} on ${background}`).toBeGreaterThanOrEqual(7);
    }
  });

  it('the focus outline is visible against the background (3:1 for non-text)', () => {
    expect(contrast(token('accent'), token('bg'))).toBeGreaterThanOrEqual(3);
  });
});
