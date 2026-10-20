import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { open, output, runCommand } from './fixtures';

const scan = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();

test.beforeEach(async ({ page }) => open(page));

test('the welcome screen has no axe violations', async ({ page }) => {
  expect((await scan(page)).violations).toEqual([]);
});

test('every kind of output has no axe violations', async ({ page }) => {
  for (const command of ['help', 'first-round', 'technical', 'about', 'experience', 'education', 'cv', 'interview', 'projects', 'projects zim-connections', 'projects sol all', 'skills', 'soft-skills', 'stories zim-black-friday full', 'interests', 'approach', 'contact', 'history', 'nope', 'what is sol?']) {
    await runCommand(page, command);
  }
  await page.getByRole('textbox', { name: 'Command' }).fill('projects zim');
  await page.getByRole('textbox', { name: 'Command' }).press('Tab');
  expect((await scan(page)).violations).toEqual([]);
});

test('the page has one h1, a main landmark and a labelled output log', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(output(page)).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
});

test('new output is added to the live region, so screen readers announce it', async ({ page }) => {
  await runCommand(page, 'contact');
  await expect(output(page).getByRole('heading', { name: 'Contact' })).toBeVisible();
  await expect(output(page)).toContainText('You ran: contact');
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('nothing transitions or animates', async ({ page }) => {
    const chip = page.getByRole('navigation', { name: 'Quick commands' }).getByRole('button', { name: 'About' });
    const durations = await chip.evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(durations.split(',').every((value) => parseFloat(value) === 0)).toBe(true);
  });
});
