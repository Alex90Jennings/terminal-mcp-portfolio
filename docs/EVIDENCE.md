# Evidence: STAR stories, soft skills and interests

The portfolio shows the person behind the code through **evidence, not adjectives**: every soft skill is demonstrated by a real example, and every example says where it comes from and who did what.

**Status:** 15 stories, 7 interests and 2 background items, each reviewed and approved by Alex before publication.

## Where it lives

One authored file, `content/evidence.json`, validated by the same pipeline as the rest of the knowledge base (`packages/knowledge`). It holds:

| Part | What it is |
| :-- | :-- |
| `stories` | STAR stories: Situation, Task, Action, Result and an optional Reflection |
| `competencies` | The 17 soft skills and engineering mindsets, each pointing at its stories (strongest first) |
| `interests` | Personal and technical interests |
| `background` | Motivation (why software) and working environment |
| `sources` | The sources the above cite: Alex's interview answers, the CV, and the project documents the stories draw on |

Project records stay the technical source of truth: a story about the live chat restates what the ZIM Connections record says, and a test checks that every figure in a documented part of a story appears in its linked project.

## The story schema

```text
Story
  id, title, projects[], organisation?
  situation, task, action, result     each a StoryPart
  reflection?                          a StoryPart
  competencies[]                       competency ids; each competency must list the story back
  questions[]                          interview questions it answers
  attribution                          individual | collaborative | team
  attributionNote                      who did what, in plain words; always shown
  status                               approved | needs-review | incomplete
  visibility                           public | private | draft

StoryPart
  text        the short telling
  detail?     added in the detailed telling
  provenance  documented | firsthand | inferred
  sources[]   ids declared in `sources`
```

**One set of facts, two versions.** The short version is each part's `text`; the detailed version adds `detail` and the reflection. Both come from the same fields, so they can't contradict each other.

**Provenance**, per part:
- `documented`: the project records and their sources;
- `firsthand`: Alex's own account, not independently verified. Shown to readers as "Alex's own account";
- `inferred`: drafted narrative Alex hasn't confirmed. **Never publishable**: the build refuses a published story with an inferred part. The current catalogue has none.

**Attribution** keeps individual, collaborative and team work apart, with a note that says exactly who did what (for example, "Alex researched the services and presented the recommendations. This does not claim Alex implemented every infrastructure change."). Stories and project records agree: the ZIM Connections record and the multi-tenancy story both say Alex collaborated with another developer to design and implement the multi-tenant architecture, and a test checks the MCP output of all three (project, experience and story) says so.

## Publication

Publication is enforced in one place, the bundle build, because the generated bundle is what both the terminal (in the browser) and the MCP server read. Filtering in the UI alone would still ship drafts to the browser.

- **Published** means `visibility: "public"` **and** `status: "approved"`. Everything else stays out of the bundle.
- **A competency** is published only with at least one published story, so it's never shown as a strength without an example.
- **Cross-references are validated:** unknown projects, competencies, stories or sources fail the build, as do a story and competency that don't point at each other, and a competency with neither stories nor a stated evidence gap.
- **A local preview** (`npm run dev:preview -w @portfolio/web`, or `KNOWLEDGE_PREVIEW=drafts`) includes drafts, never private items, and marks the bundle `preview`. Only a local development server may serve it:
  - the knowledge build refuses it on Vercel, in CI and with `NODE_ENV=production`;
  - `next.config.ts` refuses to build or start (`next build`, `next start`) with a preview bundle, before anything is compiled;
  - the server knowledge base (which the MCP tools, the API routes and the assistant all read) refuses one on any Vercel deployment and under `NODE_ENV=production`;
  - the browser knowledge base refuses one in a production bundle (`NODE_ENV` is inlined at build time);
  - `npm run build` regenerates the bundle without drafts first, and the generated bundle is never committed.

  Each guard has a regression test (`apps/web/test/preview-guard.test.ts`). The terminal labels every preview story.

## Competencies

The 17 competencies, in two groups:
- **Soft skills:** collaboration, communication, problem-solving, attention to detail, ownership and accountability, adaptability, prioritisation, conflict resolution, handling feedback, learning from failure, initiative, customer focus.
- **Engineering and product mindset:** balancing speed and quality, working with ambiguity, technical decision-making, cross-functional ownership, continuous improvement.

Each has a neutral description, aliases (everyday wording such as "disagreement", "trade-off" or "went wrong", so a natural question finds it), its stories (strongest first), two or three interview questions, and, where the evidence is thin, a plainly stated `gap`. The full mapping is in `content/evidence.json`.

Where the evidence for a competency is thin, its `gap` says so plainly, and the terminal and the assistant show it. Nothing is invented to fill a gap.

## How it's used

**Terminal:**
- `soft-skills` lists the 17 competencies; `soft-skills <name|number>` shows the strongest example, with more examples and any evidence gap.
- `soft-skills questions [name]` lists interview questions.
- `stories` lists the stories; `stories <id>` tells the short version and `stories <id> full` the detailed one. A story is shown as one paragraph, with no Situation, Task, Action or Result labels and no mention of STAR anywhere on the site. The short version tells the action in full (most of the story is what Alex did) and keeps the background, task and outcome short; the detailed version adds their detail and the reflection.
- `interests` shows personal and technical interests, motivation and working style.
- Each project page lists, under **What it demonstrates**, the soft skills its stories show and its technical skills, and under **Examples** its stories, each a link.
- `experience` shows each role's responsibilities (with scope) and the stories from that role.

With nothing published, each command says so; in a preview each output starts with a preview notice.

**MCP** (see [MCP.md](MCP.md)): `get_examples` tells stories by competency, project, keywords or id, with `exclude` for "another example", and reports `matched` and `complete` so a client never mistakes a partial list for the whole. `get_skills` lists soft skills with their examples; `get_profile` adds interests and background. `get_project` and `search_projects` point at a project's published examples, so a fact told only in an example is never reported as undocumented (see [AI.md](AI.md)). Each story part carries a user-facing `basis` ("project records" or "Alex's own account"); review status, visibility and raw provenance never leave the bundle.

**AI assistant** (prompt `2026-10-20.10`): picks the format from the question. A factual question gets a direct answer; "is Alex good at X?" gets one concise example; "tell me about a time…" gets one flowing paragraph (a sentence of background, a short clause on what needed doing, most of it on what Alex did, then the outcome, with the reflection where one exists), never labelled parts or the word STAR. Each answer opens with one short, friendly line, and greetings or small talk get a warm reply that invites a question about Alex. It keeps the attribution note, says "by Alex's account" where it matters, never describes Alex with unsupported adjectives, and for "another example" calls `get_examples` again with the stories already told excluded. The figure check, the absence check and the presentation guards apply unchanged.

## Evaluation

The 46-turn baseline is unchanged. A separately versioned suite, `star-2026-10-20.4` in `apps/web/evaluation/cases-star.ts`, adds 29 conversations (33 turns) on behavioural questions, interests, attribution limits, ZIM and Operafy cost results kept apart, and multi-turn follow-ups. It runs against whatever bundle has its stories: the published one now, or a local preview. Haiku's first run (20 October 2026) passed 28 of 33 automated checks; the human review found 28 pass, 4 needing attention and 1 fail. See [EVALUATION.md](EVALUATION.md).
