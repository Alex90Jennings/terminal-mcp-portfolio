import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { open, output, prompt, runCommand } from './fixtures';

/*
 * The real /api/chat route, chat loop and MCP tools, answered by the scripted
 * model (see playwright.config.ts): no AWS, no keys, no cost.
 */
test.beforeEach(async ({ page }) => open(page));

test('a question streams a grounded answer with sources and project links', async ({ page }) => {
  await runCommand(page, 'Which project best demonstrates Terraform?');
  const answer = output(page);
  await expect(answer).toContainText('The most relevant project is Operafy.');
  await expect(answer).toContainText('Demo mode: this answer comes from a scripted search');
  await expect(answer.getByRole('list', { name: 'Portfolio lookups' })).toContainText('search_projects: Which project best demonstrates Terraform?');
  await expect(answer.getByText('Sources:')).toBeVisible();
  await expect(answer.getByRole('link', { name: /operafy-infra README/ })).toHaveAttribute('target', '_blank');
  await answer.getByRole('button', { name: 'Operafy' }).last().click();
  await expect(answer.getByRole('heading', { level: 2, name: 'Operafy' })).toBeVisible();
});

test('follow-up questions continue the signed conversation', async ({ page }) => {
  // Request bodies are deterministic; streamed response bodies aren't reliably readable from the browser.
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/chat')) sent.push(request.postData() ?? '');
  });
  await runCommand(page, 'ask Which project best demonstrates Docker?');
  await expect(output(page)).toContainText('The most relevant project is Clash of Langs.');
  await runCommand(page, 'ask what about accessibility?');
  await expect(output(page)).toContainText('The most relevant project is SOL.');
  // The server accepted the history it signed: no "couldn't be verified" reset.
  await expect(output(page)).not.toContainText('couldn’t be verified');
  const followUp = JSON.parse(sent[1] ?? '{}') as { conversation?: { turns: { role: string; text: string }[]; signature: string } };
  expect(followUp.conversation?.turns[0]).toEqual({ role: 'user', text: 'Which project best demonstrates Docker?' });
  expect(followUp.conversation?.turns[1]?.role).toBe('assistant');
  expect(followUp.conversation?.signature).toMatch(/^v1\./);
});

test('the assistant reports when its budget is exhausted, and commands keep working', async ({ page }) => {
  await page.route('**/api/chat', (route) =>
    route.fulfill({ status: 503, json: { error: 'budget_exhausted', message: 'The AI assistant has reached its spending limit for now.' } }),
  );
  await runCommand(page, 'What is your experience with AWS?');
  await expect(output(page)).toContainText('reached its spending limit');
  await expect(output(page).getByRole('button', { name: 'ZIM Connections' }).last()).toBeVisible();
  await runCommand(page, 'projects');
  await expect(output(page).getByRole('heading', { name: 'Available projects' })).toBeVisible();
});

test('Esc stops an answer that is still coming in', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard shortcut');
  await page.route('**/api/chat', () => {
    // Never answers: the request stays open until cancelled.
  });
  await runCommand(page, 'Tell me about SOL?');
  await expect(output(page)).toContainText('Thinking…');
  await prompt(page).press('Escape');
  await expect(output(page)).toContainText('Stopped.');
});

test('clear starts a new conversation', async ({ page }) => {
  const bodies: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/chat')) bodies.push(request.postData() ?? '');
  });
  await runCommand(page, 'ask what is sol');
  await expect(output(page)).toContainText('The most relevant project is SOL.');
  await runCommand(page, 'clear');
  await runCommand(page, 'ask what is operafy');
  await expect(output(page)).toContainText('The most relevant project is Operafy.');
  expect(JSON.parse(bodies[1] ?? '{}')).not.toHaveProperty('conversation');
});

test('an answer has no accessibility violations and is announced once complete', async ({ page }) => {
  await runCommand(page, 'Which project best demonstrates Docker?');
  await expect(output(page)).toContainText('Sources:');
  await expect(page.getByRole('status')).toContainText('Answer: The most relevant project is Clash of Langs.');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  expect(results.violations).toEqual([]);
});
