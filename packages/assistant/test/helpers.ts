import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { buildBundle, createKnowledgeBase, type Evidence } from '@portfolio/knowledge';
import { loadBundle, readContent } from '@portfolio/knowledge/node';
import { connectInProcess } from '@portfolio/mcp-server';
import { runChat, type ChatEvent, type ChatOptions } from '../src/chat.ts';
import { MODEL_PRICES } from '../src/cost.ts';
import { ScriptedModel, type Script } from '../src/scripted.ts';

const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../content');
export const kb = createKnowledgeBase(await loadBundle(contentDir));
export const projects = kb.projects.map(({ id, name }) => ({ id, name }));
/** Includes the draft stories, as a local preview would: for testing how retrieval treats examples. */
export const previewKb = createKnowledgeBase(await loadBundle(contentDir, { includeDrafts: true }));
/** The same content with every story and interest back in draft, so nothing but the project records is published. */
export const noExamplesKb = await (async () => {
  const raw = await readContent(contentDir);
  const drafts = structuredClone(raw.evidence!.data) as Evidence;
  for (const item of [...drafts.stories, ...drafts.interests.personal, ...drafts.interests.technical, ...drafts.background.motivation, ...drafts.background.workingEnvironment]) {
    Object.assign(item, { status: 'needs-review', visibility: 'draft' });
  }
  return createKnowledgeBase(buildBundle({ ...raw, evidence: { ...raw.evidence!, data: drafts } }));
})();

export const opus = MODEL_PRICES['claude-opus-5-5']!;

export async function chat(script: Script, overrides: Partial<ChatOptions> = {}, knowledge = kb) {
  const mcp: Client = await connectInProcess(knowledge);
  const events: ChatEvent[] = [];
  const outcome = await runChat({
    model: new ScriptedModel(script),
    price: opus,
    mcp,
    history: [],
    question: 'Which project best demonstrates Docker?',
    projects,
    maxRounds: 4,
    maxOutputTokens: 1024,
    maxInputTokensPerCall: 24_000,
    maxCostUsd: 1,
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    ...overrides,
  });
  await mcp.close();
  return { outcome, events, text: events.flatMap((event) => (event.type === 'text' ? [event.delta] : [])).join('') };
}
