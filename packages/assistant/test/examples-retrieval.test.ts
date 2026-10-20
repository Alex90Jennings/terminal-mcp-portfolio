import { connectInProcess } from '@portfolio/mcp-server';
import { describe, expect, it } from 'vitest';
import { RetrievalLedger } from '../src/absence.ts';
import { storiesTold } from '../src/evidence.ts';
import type { ModelRequest } from '../src/model.ts';
import { chat, noExamplesKb, previewKb, projects } from './helpers.ts';

/*
 * Examples (STAR stories) hold facts the project records don't: the SNS
 * migration and the AWS cost review are told only in ZIM Connections' examples.
 * A project record, even a full one, must not let the assistant say such a
 * fact is undocumented. Tested against the preview bundle; a bundle with no
 * published examples must behave as it did before examples existed.
 */

type ProjectResult = { complete: boolean; note?: string; examples?: { id: string }[]; relatedFromExamples?: { example: string; text: string; basis: string }[] };

async function firstToolResult(question: string, input: Record<string, unknown>, knowledge = previewKb): Promise<ProjectResult> {
  let toolResult = '';
  await chat(
    (request: ModelRequest, call) => {
      if (call === 1) {
        const last = request.messages.at(-1)!.content[0]!;
        if (last.type === 'tool_result') toolResult = last.content;
      }
      return call === 0 ? { toolCalls: [{ name: 'get_project', input }] } : { text: 'Done.' };
    },
    { question },
    knowledge,
  );
  return JSON.parse(toolResult) as ProjectResult;
}

describe('a project record is not everything documented about the project', () => {
  it('a full ZIM Connections record is not complete while it has examples, and says where to look', async () => {
    const result = await firstToolResult('What did Alex do at ZIM?', { project: 'zim-connections' });
    expect(result.complete).toBe(false);
    expect(result.examples?.map(({ id }) => id)).toEqual(expect.arrayContaining(['zim-sns-migration', 'zim-black-friday', 'zim-aws-cost-review']));
    expect(result.note).toMatch(/get_examples/);
  });

  it('carries the example passages that answer the question, with their basis', async () => {
    const result = await firstToolResult('Did Alex migrate the notifications at ZIM away from Firebase?', { project: 'zim-connections' });
    const passage = result.relatedFromExamples?.find(({ example }) => example === 'zim-sns-migration');
    expect(passage?.text).toMatch(/Firebase/);
    expect(passage?.basis).toBe("Alex's own account");
  });

  it('leaves a bundle with no published examples exactly as before', async () => {
    const result = await firstToolResult('Did Alex migrate the notifications at ZIM away from Firebase?', { project: 'zim-connections' }, noExamplesKb);
    expect(result.complete).toBe(true);
    expect(result).not.toHaveProperty('examples');
    expect(result).not.toHaveProperty('relatedFromExamples');
    expect(result).not.toHaveProperty('note');
  });
});

describe('figure grounding is unchanged', () => {
  const answer = 'ZIM reduced its AWS bill by approximately 30%.';
  const script = (_request: ModelRequest, call: number) =>
    call === 0 ? { toolCalls: [{ name: 'get_project', input: { project: 'zim-connections' } }] } : { text: answer };

  it('releases a figure that an example passage retrieved this turn contains', async () => {
    const { text } = await chat(script, { question: "Did Alex reduce ZIM's AWS costs?" }, previewKb);
    expect(text).toBe(answer);
  });

  it('withholds the same figure when no published example or record contains it', async () => {
    const { text, outcome } = await chat(script, { question: "Did Alex reduce ZIM's AWS costs?" }, noExamplesKb);
    expect(text).toBe('');
    expect(outcome.withheld[0]?.figures).toEqual(['30%']);
  });
});

describe('the absence check counts examples as part of a project', async () => {
  const client = await connectInProcess(previewKb);
  const records = new Map<string, Record<string, unknown>>();
  const examples = new Map<string, string[]>();
  for (const { id } of projects) {
    const full = (await client.callTool({ name: 'get_project', arguments: { project: id } })).structuredContent as { project: Record<string, unknown>; examples?: { id: string }[] };
    records.set(id, full.project);
    examples.set(id, (full.examples ?? []).map((example) => example.id));
  }
  const claim = "The portfolio doesn't record any examples of how Alex worked at ZIM Connections.";
  const record = async (ledger: RetrievalLedger, tool: string, args: Record<string, unknown>) => ledger.record(tool, (await client.callTool({ name: tool, arguments: args })).structuredContent);

  it('withholds "no examples" about a project whose examples were never fetched, even after its full record', async () => {
    const ledger = new RetrievalLedger(projects, records, examples);
    await record(ledger, 'get_project', { project: 'zim-connections' });
    expect(ledger.check(claim, '')).toEqual({ text: claim, project: 'ZIM Connections' });
  });

  it('releases it once get_examples has answered in full', async () => {
    const ledger = new RetrievalLedger(projects, records, examples);
    await record(ledger, 'get_examples', { competency: 'conflict-resolution' });
    expect(ledger.check(claim, '')).toBeUndefined();
  });

  it('does not release it on a partial get_examples answer', async () => {
    const ledger = new RetrievalLedger(projects, records, examples);
    await record(ledger, 'get_examples', { project: 'zim-connections', limit: 1 });
    expect(ledger.unseenSections('zim-connections')).toContain('examples');
  });

  it('is a no-op for projects with no examples', () => {
    const ledger = new RetrievalLedger(projects, records, new Map());
    expect(ledger.unseenSections('zim-connections')).not.toContain('examples');
  });
});

describe('which examples an answer told (for follow-ups)', () => {
  const friday = { id: 'zim-black-friday', title: 'Fixing the Black Friday discount problem', action: { text: 'Alex paused the current task, investigated, reproduced the behaviour in a development environment, and changed the promotion logic: customers could change the applied promotion, and the larger eligible discount was selected automatically.' }, result: { text: 'Customers could use the most advantageous eligible discount instead of being limited to the Black Friday offer.' } };
  const sql = { id: 'zim-sql-performance', title: 'Speeding up the eSIM retrieval endpoint', action: { text: 'Alex traced the SQL queries the endpoint ran and read through the backend code.' }, result: { text: 'Response times fell from roughly 2–9 seconds to 0.5–1.5 seconds.' } };

  it('counts a story the answer retells, not one that was only retrieved', () => {
    const answer = 'Action: Alex paused the current task, reproduced the behaviour in a development environment and changed the promotion logic so the larger eligible discount was selected automatically. Result: customers could use the most advantageous eligible discount.';
    expect(storiesTold(answer, [friday, sql])).toEqual([{ id: 'zim-black-friday', title: 'Fixing the Black Friday discount problem' }]);
  });

  it('counts a story named by its title, and nothing for an answer that tells none', () => {
    expect(storiesTold('See "Speeding up the eSIM retrieval endpoint" for details.', [friday, sql]).map(({ id }) => id)).toEqual(['zim-sql-performance']);
    expect(storiesTold('The portfolio doesn’t document a leadership example.', [friday, sql])).toEqual([]);
  });

  it('runChat reports the story an answer told', async () => {
    const answer = 'Situation: during a Black Friday promotion, customers with a larger eligible discount couldn’t use it. Action: Alex paused the current task, reproduced the behaviour in a development environment and changed the promotion logic so the larger eligible discount was selected automatically. Result: customers could use the most advantageous eligible discount.';
    const { outcome } = await chat((_request, call) => (call === 0 ? { toolCalls: [{ name: 'get_examples', input: { query: 'production incident' } }] } : { text: answer }), { question: 'Tell me about a production incident.' });
    expect(outcome.stories).toEqual([{ id: 'zim-black-friday', title: 'Fixing the Black Friday discount problem' }]);
  });
});

describe('examples follow the competency the visitor named, not the model’s paraphrase', () => {
  it('"What is your biggest weakness?" searched as "a mistake or weakness" still returns the weakness example', async () => {
    let toolResult = '';
    await chat(
      (request: ModelRequest, call) => {
        if (call === 1) {
          const last = request.messages.at(-1)!.content[0]!;
          if (last.type === 'tool_result') toolResult = last.content;
        }
        return call === 0 ? { toolCalls: [{ name: 'get_examples', input: { query: 'a mistake or weakness, something Alex struggled with' } }] } : { text: 'Done.' };
      },
      { question: 'What is your biggest weakness?' },
    );
    const result = JSON.parse(toolResult) as { examples: { id: string }[]; competency?: { id: string } };
    expect(result.competency?.id).toBe('self-awareness');
    expect(result.examples[0]?.id).toBe('zim-estimates-feedback');
  });
});
