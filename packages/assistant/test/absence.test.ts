import { connectInProcess } from '@portfolio/mcp-server';
import { describe, expect, it } from 'vitest';
import { RetrievalLedger } from '../src/absence.ts';
import { absenceNotice } from '../src/chat.ts';
import { toPlainText } from '../src/evidence.ts';
import type { ModelRequest } from '../src/model.ts';
import { chat, kb, projects } from './helpers.ts';

// Full records, as runChat loads them for verification.
const client = await connectInProcess(kb);
const records = new Map<string, Record<string, unknown>>();
for (const { id } of projects) {
  records.set(id, ((await client.callTool({ name: 'get_project', arguments: { project: id } })).structuredContent as { project: Record<string, unknown> }).project);
}
const fetched = async (ledger: RetrievalLedger, project: string, sections?: string[]) =>
  ledger.record('get_project', (await client.callTool({ name: 'get_project', arguments: { project, ...(sections && { sections }) } })).structuredContent);

describe('the absence check (regression: backend-projects)', () => {
  const claim = "ZIM@SBB shares ZIM Connections' core application and backend, but the portfolio doesn't record Alex's specific responsibilities on it.";

  it('withholds a claim that a project has no responsibilities recorded when that section was never retrieved', () => {
    const ledger = new RetrievalLedger(projects, records);
    expect(ledger.check(claim, '')).toEqual({ text: claim, project: 'ZIM@SBB' });
  });

  it('releases the same sentence once the section has been retrieved', async () => {
    const ledger = new RetrievalLedger(projects, records);
    await fetched(ledger, 'zim-sbb', ['responsibilities']);
    expect(ledger.check(claim, '')).toBeUndefined();
  });

  it('counts sections retrieved across several calls in the same turn', async () => {
    const ledger = new RetrievalLedger(projects, records);
    await fetched(ledger, 'clash-of-langs', ['overview']);
    expect(ledger.unseenSections('clash-of-langs')).toContain('challenges');
    await fetched(ledger, 'clash-of-langs', ['challenges', 'decisions']);
    expect(ledger.unseenSections('clash-of-langs')).not.toContain('challenges');
    await fetched(ledger, 'clash-of-langs');
    expect(ledger.unseenSections('clash-of-langs')).toEqual([]);
  });

  it('applies to the project named earlier when the sentence doesn’t name one', () => {
    const ledger = new RetrievalLedger(projects, records);
    expect(ledger.check("But the portfolio doesn't record its decisions.", 'Clash of Langs runs 24 runtimes. ')?.project).toBe('Clash of Langs');
  });

  // Correct "not documented" answers from the recorded Haiku runs: none may be withheld.
  it.each([
    ['sol', ['overview', 'links', 'undocumented'], "The portfolio doesn't record SOL Pro's price."],
    ['sol', ['overview', 'limitations', 'undocumented'], "The portfolio doesn't record any download or user figures for SOL."],
    ['zim-sbb', ['overview', 'technologies', 'undocumented'], "The portfolio doesn't name the four languages ZIM@SBB supports."],
    ['total-guess', ['overview', 'architecture'], "The portfolio doesn't document whether the assistant is deployed publicly."],
    ['operafy', ['responsibilities'], "The portfolio doesn't record a speed improvement for Operafy."],
  ])('releases a correct claim about %s after a partial lookup: %j', async (project, sections, sentence) => {
    const ledger = new RetrievalLedger(projects, records);
    await fetched(ledger, project, sections);
    expect(ledger.check(sentence, '')).toBeUndefined();
  });

  it('ignores sentences that make no claim about what the portfolio records', () => {
    const ledger = new RetrievalLedger(projects, records);
    expect(ledger.check('ZIM@SBB has responsibilities split between Alex and the product team.', '')).toBeUndefined();
    expect(ledger.check("The portfolio doesn't document a Kubernetes migration at ZIM.", '')).toBeUndefined();
  });
});

describe('the absence check in runChat', () => {
  it('withholds the claim, says why in plain words, and releases the rest', async () => {
    const { text, outcome, events } = await chat(
      (_request, call) =>
        call === 0
          ? { toolCalls: [{ name: 'search_projects', input: { query: 'backend' } }] }
          : { text: "ZIM Connections has a NestJS backend. ZIM@SBB shares that backend, but the portfolio doesn't record Alex's specific responsibilities on it." },
      { question: 'Which projects demonstrate backend development?' },
    );
    expect(text).toBe('ZIM Connections has a NestJS backend. ');
    expect(outcome.withheld).toEqual([
      { text: "ZIM@SBB shares that backend, but the portfolio doesn't record Alex's specific responsibilities on it.", figures: [], project: 'ZIM@SBB' },
    ]);
    expect(events).toContainEqual({ type: 'notice', message: absenceNotice(1) });
  });

  it('passes the visitor’s question to get_project, so a partial record carries what it left out (regression: clash-why-not-serverless)', async () => {
    let toolResult = '';
    await chat(
      (request: ModelRequest, call) => {
        if (call === 1) {
          const last = request.messages.at(-1)!.content[0]!;
          if (last.type === 'tool_result') toolResult = last.content;
        }
        return call === 0
          ? { toolCalls: [{ name: 'get_project', input: { project: 'clash-of-langs', sections: ['architecture', 'decisions', 'technologies', 'limitations', 'undocumented'] } }] }
          : { text: 'Vercel hosts only the UI and a thin API.' };
      },
      { question: 'Why does Clash of Langs not run its benchmarks on Vercel or in WebAssembly?' },
    );
    const result = JSON.parse(toolResult) as { complete: boolean; omittedSections: string[]; relatedFromOmitted: { section: string; text: string }[] };
    expect(result.complete).toBe(false);
    expect(result.omittedSections).toContain('challenges');
    expect(result.relatedFromOmitted.some(({ section, text }) => section === 'challenges' && /Vercel hosts only the UI/.test(text))).toBe(true);
  });

  it('never uses the records it loads for verification as evidence', async () => {
    // 2,623 is in ZIM Connections' record, which this turn never retrieved.
    const { text, outcome } = await chat(() => ({ text: 'Alex grew the suite to 2,623 tests.' }));
    expect(text).toBe('');
    expect(outcome.withheld[0]?.figures).toEqual(['2,623']);
  });
});

describe('retrieval metadata stays out of what visitors see', () => {
  it('the absence notice names no field, section or tool', () => {
    for (const count of [1, 3]) {
      expect(absenceNotice(count)).not.toMatch(/omittedSections|relatedFromOmitted|relatedTo|complete|section|get_project|undocumented|partial record/i);
    }
  });

  it('removes a pasted "Sources:" line (regression: zim-live-chat), but not an ordinary use of the word', () => {
    expect(toPlainText('Sources: CV (September 2026), ZIM Connections project record.')).toBe('');
    expect(toPlainText('The chat had supported 100,000+ messages.\nSources: CV')).toBe('The chat had supported 100,000+ messages.\n');
    expect(toPlainText('The audit drew on several sources: Cost Explorer and the README.')).toBe('The audit drew on several sources: Cost Explorer and the README.');
  });

  it('removes a pasted source line through runChat', async () => {
    const { text } = await chat((_request, call) =>
      call === 0
        ? { toolCalls: [{ name: 'get_project', input: { project: 'operafy', sections: ['decisions'] } }] }
        : { text: 'Operafy uses GitHub OIDC.\nSources: operafy-infra README.' },
    );
    expect(text.trim()).toBe('Operafy uses GitHub OIDC.');
  });
});
