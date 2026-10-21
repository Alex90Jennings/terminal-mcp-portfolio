# Alex Jennings: terminal portfolio and MCP server

An interactive developer portfolio that works like a terminal, backed by a typed, source-cited knowledge base and exposed to AI clients through a public [Model Context Protocol](https://modelcontextprotocol.io) server.

> This README covers what exists so far. Full documentation (architecture, AI integration, deployment) arrives in a later stage.

## Workspace

```
content/               The knowledge base: profile, skills, seven projects and STAR evidence, every claim cited
packages/knowledge     Schema, validation, build step and read-only queries
packages/mcp-server    Read-only MCP server: 7 tools, 4 resources, Streamable HTTP and stdio
packages/assistant     Provider-neutral AI assistant: chat loop over the MCP tools, Claude adapter, grounding
apps/web               Next.js terminal UI, the public /api/mcp endpoint and the /api/chat assistant
infra/bedrock          Terraform: least-privilege, OIDC-only IAM role for Claude on Amazon Bedrock
infra/cv               Terraform: the private CV bucket's settings and a read-one-object OIDC role
docs/MCP.md            MCP tools, resources, security and client set-up
docs/AI.md             The AI assistant: architecture, grounding, budgets, failure behaviour
docs/AI_GUARDRAILS.md  The assistant's security boundary: scope, injection defences, limits, test status
docs/EVALUATION.md     The model evaluation: questions, scoring, costs, how to run it
docs/CV_DOWNLOAD.md    The CV download: private S3, OIDC, IAM policies, verification
```

## Getting started

Requires Node.js 22+.

```bash
npm install
npm run dev          # http://localhost:3000, with the MCP endpoint at /api/mcp
npm run mcp:stdio    # the MCP server over stdio
```

## Checks

```bash
npm run check        # knowledge build, type check, lint, unit tests, production build
npm run test:e2e     # Playwright: terminal on desktop, Android and iPhone, plus the MCP endpoint
```

## AI assistant

Commands start with `/` (`/help`, `/projects sol`). Anything else, from "hi" to "Why should we hire Alex?", goes to the assistant; a bare command name or project name still runs as a shortcut. Where the browser supports it, visitors can also ask by voice (the microphone beside the prompt) and have answers read aloud, using the browser's own Web Speech API: no extra service, key or cost. Answers to spoken questions are read back automatically; typed ones only when "Read aloud" is pressed. The `Permissions-Policy` header allows the microphone for this origin only. Answers come only from the verified portfolio, via the MCP tools, and the sources behind each answer are recorded for evaluation. By default it runs on a scripted model (no keys, no cost). With `AI_PROVIDER=anthropic` and an API key it uses Claude Haiku 5.5 through the direct Anthropic API, which is how it runs in production at [www.builtbyaj.io](https://www.builtbyaj.io); Amazon Bedrock remains a supported alternative. Every answer counts against a $10/day and $50/month budget. See [docs/AI.md](docs/AI.md).

## The interview

The welcome screen frames the terminal as a first-stage interview, with example questions to click (each runs exactly as if typed). There are two ways in, both to the same assistant:
- the **First Round Interview** (`first-round`): background, experience, soft skills and competency questions;
- the **Technical Interview** (`technical`): engineering, architecture and the decisions behind it.

The chips under the prompt cover the main areas: About, Experience, Projects, Soft skills, First Round Interview, Education, Interests, Technical Interview and Contact. `stories` and `ask` still work.

Recruiter-friendly commands:
- `experience`;
- `education`, which keeps earned certifications apart from those in progress;
- `cv`, a summary with a download link to `/api/cv`, which streams the PDF from a private S3 bucket using Vercel OIDC (see [docs/CV_DOWNLOAD.md](docs/CV_DOWNLOAD.md); the CV is never read for facts);
- `interview`, which offers questions to try. After an AI answer, follow-ups are offered only from what it referenced: the full story it told, another example, or Alex's role on the one project it was about. No extra AI call is made.

## Soft skills, stories and interests

Soft skills are shown through real examples (`soft-skills`, `stories`), each told as one paragraph built from the STAR evidence, alongside `interests`. Each example says who did what and whether it comes from the project records or Alex's own account. Every story and interest is reviewed and approved by Alex before it is published; drafts can be previewed locally with `npm run dev:preview -w @portfolio/web`. See [docs/EVIDENCE.md](docs/EVIDENCE.md).

## MCP

Connect any MCP client to `https://<your-domain>/api/mcp`. For example, in Claude Code:

```bash
claude mcp add --transport http alex-portfolio https://<your-domain>/api/mcp
```

The tools are `list_projects`, `get_project`, `search_projects`, `get_profile`, `get_experience`, `get_skills` and `get_examples`. The resources are `portfolio://profile`, `portfolio://skills`, `portfolio://projects` and `portfolio://projects/{id}`. See [docs/MCP.md](docs/MCP.md) for details, security and deployment.

## Updating content

Edit the JSON in `content/`; the schemas in `content/schemas/` give editor autocompletion. Every claim needs at least one source, and claims marked `"status": "unverified"` are kept out of everything public. `npm run knowledge:build` validates the content and regenerates the bundle that the terminal and MCP server both read.
