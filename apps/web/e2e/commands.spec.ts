import { expect, test } from '@playwright/test';
import { open, output, prompt, runCommand } from './fixtures';

test.beforeEach(async ({ page }) => open(page));

test('greets visitors as a first-stage interview and tells them how to start', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: 'Alex Jennings' })).toBeVisible();
  await expect(output(page)).toContainText('think of it as a first-stage interview');
  await expect(output(page)).toContainText('Ask me anything to get to know Alex, and why you should hire him. Try help if you can’t think of anything to ask:');
  // No interview cards or suggested questions in the terminal: the interviews are the chips below it.
  await expect(output(page).getByRole('button')).toHaveText(['help']);
  await expect(page).toHaveTitle(/Alex Jennings/);
});

test('the greeting’s help link runs help', async ({ page }) => {
  await output(page).getByRole('button', { name: 'help', exact: true }).click();
  await expect(output(page).getByRole('heading', { name: 'Commands' })).toBeVisible();
});

test('a typed question goes to the assistant', async ({ page }) => {
  await runCommand(page, 'What has Alex built?');
  // Answered by the scripted assistant (see playwright.config.ts).
  await expect(output(page).getByRole('list', { name: 'Portfolio lookups' }).last()).toContainText('What has Alex built?');
});

test('every navigation chip opens its area', async ({ page }) => {
  const chips = page.getByRole('navigation', { name: 'Quick commands' }).getByRole('button');
  await expect(chips).toHaveText(['First Round Interview', 'Technical Interview', 'About', 'Experience', 'Projects', 'Soft skills', 'Education', 'Interests', 'Contact']);
  for (const [chip, heading] of [['Experience', 'Experience'], ['Education', 'Education'], ['Soft skills', 'Soft skills'], ['First Round Interview', 'First Round Interview'], ['Technical Interview', 'Technical Interview']] as const) {
    await page.getByRole('navigation', { name: 'Quick commands' }).getByRole('button', { name: chip, exact: true }).click();
    await expect(output(page).getByRole('heading', { level: 2, name: heading }).last()).toBeVisible();
  }
});

test('a project page links its stories and soft skills', async ({ page }) => {
  await runCommand(page, 'projects zim-connections');
  await output(page).getByRole('button', { name: 'Building real-time live chat' }).last().click();
  await expect(output(page).getByRole('heading', { level: 2, name: 'Building real-time live chat' })).toBeVisible();
});

test('help lists the commands', async ({ page }) => {
  await runCommand(page, 'help');
  await expect(output(page).getByRole('heading', { name: 'Commands' })).toBeVisible();
  for (const name of ['about', 'projects', 'skills', 'contact', 'history', 'clear']) {
    await expect(output(page).getByRole('button', { name, exact: false }).first()).toBeVisible();
  }
});

test('projects lists all seven, and a project opens by click, number, name or alias', async ({ page }) => {
  await runCommand(page, 'projects');
  const listing = output(page).getByRole('list').last();
  await expect(listing.getByRole('listitem')).toHaveCount(7);

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

test('each interview mode offers questions that run as typed', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Quick commands' }).getByRole('button', { name: 'Technical Interview', exact: true }).click();
  await output(page).getByRole('button', { name: 'How does Clash of Langs ensure fair benchmarking?' }).click();
  await expect(output(page).getByRole('list', { name: 'Portfolio lookups' }).last()).toContainText('How does Clash of Langs ensure fair benchmarking?');
});

test('only approved downloads are served: no content file, and no CV until one is added', async ({ request }) => {
  expect((await request.get('/api/cv')).status()).toBe(404);
  expect((await request.post('/api/cv')).status()).toBe(405);
  for (const url of ['/cv-alex-jennings.pdf', '/content/profile.json', '/content/evidence.json', '/evidence.json', '/profile.json', '/content/cv-alex-jennings.pdf', '/../content/profile.json']) {
    expect((await request.get(url)).status(), url).toBe(404);
  }
});

test('a story reads as one paragraph, with no STAR labels', async ({ page }) => {
  await runCommand(page, 'stories zim-black-friday full');
  await expect(output(page).getByRole('heading', { level: 2, name: 'Fixing the Black Friday discount problem' })).toBeVisible();
  await expect(output(page)).not.toContainText(/\bSTAR\b|Situation|Reflection/);
});
