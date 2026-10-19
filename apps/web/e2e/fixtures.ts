import { expect, type Locator, type Page } from '@playwright/test';

export const prompt = (page: Page): Locator => page.getByRole('textbox', { name: 'Command' });
export const output = (page: Page): Locator => page.getByRole('log', { name: 'Terminal output' });

/** Types a command and presses Enter, as a visitor would. */
export async function runCommand(page: Page, command: string): Promise<void> {
  const input = prompt(page);
  await input.click();
  await input.fill(command);
  await input.press('Enter');
  await expect(input).toHaveValue('');
}

export async function open(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}
