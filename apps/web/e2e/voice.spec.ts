import { expect, test, type Page } from '@playwright/test';
import { open, output, prompt, runCommand } from './fixtures';

/** Stands in for the browser's speech services: recognition "hears" `heard`, and reading aloud is recorded. */
async function fakeSpeech(page: Page, { heard, recognition = true }: { heard?: string; recognition?: boolean }) {
  await page.addInitScript(
    ({ heard, recognition }) => {
      const win = window as unknown as Record<string, unknown> & { spoken: string[] };
      win.spoken = [];
      delete win.webkitSpeechRecognition;
      delete win.SpeechRecognition;
      if (recognition) {
        win.SpeechRecognition = class {
          lang = '';
          onresult: ((event: unknown) => void) | null = null;
          onerror: ((event: unknown) => void) | null = null;
          onend: (() => void) | null = null;
          start() {
            setTimeout(() => {
              const result = Object.assign([{ transcript: heard }], { isFinal: true });
              this.onresult?.({ resultIndex: 0, results: [result] });
              this.onend?.();
            }, 50);
          }
          stop() {
            this.onend?.();
          }
          abort() {
            this.onend?.();
          }
        };
      }
      Object.defineProperty(window, 'speechSynthesis', {
        value: {
          speaking: false,
          pending: false,
          getVoices: () => [],
          cancel: () => {},
          speak: (utterance: SpeechSynthesisUtterance) => {
            win.spoken.push(utterance.text);
            setTimeout(() => utterance.onend?.(new Event('end') as SpeechSynthesisEvent), 0);
          },
        },
      });
    },
    { heard: heard ?? '', recognition },
  );
}

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { spoken: string[] }).spoken);

test('a question asked by voice goes to the assistant, and its answer is read aloud', async ({ page }) => {
  await fakeSpeech(page, { heard: 'What has Alex built' });
  await open(page);
  await page.getByRole('button', { name: 'Ask by voice' }).click();
  await expect(output(page).getByRole('list', { name: 'Portfolio lookups' }).last()).toContainText('What has Alex built');
  await expect(output(page).getByRole('button', { name: 'Read aloud' })).toBeVisible();
  await expect.poll(() => spoken(page)).not.toEqual([]);
});

test('a typed answer stays silent until "Read aloud" is pressed', async ({ page }) => {
  await fakeSpeech(page, {});
  await open(page);
  await runCommand(page, 'What has Alex built?');
  await expect(output(page).getByRole('button', { name: 'Read aloud' })).toBeVisible();
  expect(await spoken(page)).toEqual([]);
  await output(page).getByRole('button', { name: 'Read aloud' }).click();
  await expect.poll(() => spoken(page)).not.toEqual([]);
});

test('without speech recognition there is no microphone, and typing still works', async ({ page }) => {
  await fakeSpeech(page, { recognition: false });
  await open(page);
  await expect(page.getByRole('button', { name: 'Ask by voice' })).toHaveCount(0);
  await expect(prompt(page)).toBeVisible();
});
