import { expect, test } from '@playwright/test';
import { open, output, prompt, runCommand } from './fixtures';

// Hardware-keyboard behaviour; phones are covered by responsive.spec.ts.
test.skip(({ isMobile }) => isMobile, 'keyboard shortcuts are desktop behaviour');

test.beforeEach(async ({ page }) => open(page));

test('the prompt is focused on load, ready to type', async ({ page }) => {
  await expect(prompt(page)).toBeFocused();
  await page.keyboard.type('about');
  await page.keyboard.press('Enter');
  await expect(output(page).getByRole('heading', { level: 2, name: 'Alex Jennings' })).toBeVisible();
});

test('↑ and ↓ step through history and restore the draft', async ({ page }) => {
  await runCommand(page, 'help');
  await runCommand(page, 'projects');
  const input = prompt(page);
  await input.fill('dra');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('projects');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('help');
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('dra');
});

test('Tab completes commands, projects and sections', async ({ page }) => {
  const input = prompt(page);
  await input.fill('proj');
  await input.press('Tab');
  await expect(input).toHaveValue('projects ');
  await input.pressSequentially('cl');
  await input.press('Tab');
  await expect(input).toHaveValue('projects clash-of-langs ');
  await input.pressSequentially('arch');
  await input.press('Tab');
  await expect(input).toHaveValue('projects clash-of-langs architecture ');
});

test('ambiguous Tab shows the choices, which can be picked', async ({ page }) => {
  const input = prompt(page);
  await input.fill('projects zim');
  await input.press('Tab');
  await expect(input).toHaveValue('projects zim-');
  await page.getByRole('status').getByRole('button', { name: 'zim-sbb' }).click();
  await expect(input).toHaveValue('projects zim-sbb ');
  await expect(input).toBeFocused();
});

test('Tab on an empty prompt moves focus on, so keyboard users are never trapped', async ({ page }) => {
  await expect(prompt(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(prompt(page)).not.toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Quick commands' }).getByRole('button', { name: 'First Round Interview' })).toBeFocused();
});

test('the greeting’s help link is reachable with Shift+Tab and runs with Enter', async ({ page }) => {
  await expect(prompt(page)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(output(page).getByRole('button', { name: 'help', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(output(page).getByRole('heading', { name: 'Commands' })).toBeVisible();
});

test('output links are reachable with Shift+Tab and run with Enter', async ({ page }) => {
  await runCommand(page, 'projects');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'projects 3' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(output(page).getByRole('heading', { level: 2, name: 'Clash of Langs' })).toBeVisible();
  await expect(prompt(page)).toBeFocused();
});

test('Ctrl+L clears the screen, Escape clears the line, Ctrl+C cancels it', async ({ page }) => {
  await runCommand(page, 'help');
  const input = prompt(page);
  await input.press('Control+l');
  await expect(output(page)).toBeEmpty();

  await input.fill('something');
  await input.press('Escape');
  await expect(input).toHaveValue('');

  await input.fill('half-typed');
  await input.press('Control+c');
  await expect(input).toHaveValue('');
  await expect(output(page)).toContainText('half-typed^C');
});
