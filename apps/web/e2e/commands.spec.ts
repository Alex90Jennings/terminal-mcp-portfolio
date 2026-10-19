import { expect, test } from '@playwright/test';
import { open, output, prompt, runCommand } from './fixtures';

test.beforeEach(async ({ page }) => open(page));

test('greets visitors and tells them how to start', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: 'Alex Jennings' })).toBeVisible();
  await expect(output(page)).toContainText('Type help to get started');
  await expect(page).toHaveTitle(/Alex Jennings/);
});

test('help lists the commands', async ({ page }) => {
  await runCommand(page, 'help');
  await expect(output(page).getByRole('heading', { name: 'Commands' })).toBeVisible();
  for (const name of ['about', 'projects', 'skills', 'contact', 'history', 'clear']) {
    await expect(output(page).getByRole('button', { name, exact: false }).first()).toBeVisible();
  }
});

test('projects lists all six, and a project opens by click, number, name or alias', async ({ page }) => {
  await runCommand(page, 'projects');
  const listing = output(page).getByRole('list').last();
  await expect(listing.getByRole('listitem')).toHaveCount(6);

  await listing.getByRole('button', { name: 'SOL' }).click();
  await expect(output(page).getByRole('heading', { level: 2, name: 'SOL' })).toBeVisible();

  await runCommand(page, '3');
  await expect(output(page).getByRole('heading', { level: 2, name: 'Clash of Langs' })).toBeVisible();

  await runCommand(page, 'project zim@sbb');
  await expect(output(page).getByRole('heading', { level: 2, name: 'ZIM@SBB' })).toBeVisible();
});

test('project links are real, open in a new tab and are announced as such', async ({ page }) => {
  await runCommand(page, 'projects clash-of-langs');
  const link = output(page).getByRole('link', { name: 'Live arena (opens in a new tab)' });
  await expect(link).toHaveAttribute('href', 'https://clash-of-langs.vercel.app');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('section links open the deeper views', async ({ page }) => {
  await runCommand(page, 'projects total-guess');
  await output(page).getByRole('button', { name: 'challenges' }).last().click();
  await expect(output(page).getByRole('heading', { name: 'Stopping the model from inventing facts' })).toBeVisible();
});

test('an unknown command suggests the right one, and the suggestion runs', async ({ page }) => {
  await runCommand(page, 'projcts');
  await expect(output(page)).toContainText('command not found: projcts');
  await output(page).getByRole('button', { name: 'projects', exact: true }).last().click();
  await expect(output(page).getByRole('heading', { name: 'Available projects' })).toBeVisible();
});

test('a question still gets useful answers when the AI is unavailable', async ({ page }) => {
  await page.route('**/api/chat', (route) =>
    route.fulfill({ status: 503, json: { error: 'ai_unavailable', message: 'The AI assistant isn’t available right now. Commands like `projects` and `skills` still work.' } }),
  );
  await runCommand(page, 'Which project best demonstrates Docker?');
  await expect(output(page)).toContainText('The AI assistant isn’t available right now');
  await expect(output(page).getByRole('button', { name: 'Clash of Langs' }).last()).toBeVisible();
});

test('clear and history work', async ({ page }) => {
  await runCommand(page, 'help');
  await runCommand(page, 'about');
  await runCommand(page, 'history');
  await expect(output(page).getByRole('list').last().getByRole('listitem')).toHaveText(['1help', '2about', '3history']);

  await runCommand(page, 'clear');
  await expect(output(page)).toBeEmpty();
});

test('quick commands run with one tap', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Quick commands' }).getByRole('button', { name: 'contact' }).click();
  await expect(output(page).getByRole('link', { name: /^aj0312@/ })).toBeVisible();
});

test('long output scrolls to its own start, so it reads from the top', async ({ page }) => {
  await runCommand(page, 'projects zim all');
  await expect(output(page).getByRole('heading', { level: 2, name: 'ZIM Connections' }).last()).toBeInViewport();
});

test('input is capped and never executed', async ({ page }) => {
  await expect(prompt(page)).toHaveAttribute('maxlength', '500');
  await runCommand(page, '<img src=x onerror="document.title=1">');
  await expect(output(page)).toContainText('command not found');
  await expect(page).toHaveTitle(/Alex Jennings/);
});
