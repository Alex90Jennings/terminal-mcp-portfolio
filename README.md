# Alex Jennings: terminal portfolio and MCP server

An interactive developer portfolio that works like a terminal, backed by a typed, source-cited knowledge base and exposed to AI clients through a public [Model Context Protocol](https://modelcontextprotocol.io) server.

> This README covers what exists so far. Full documentation (architecture, AI integration, deployment) arrives in a later stage.

## Workspace

```
content/               The knowledge base: profile, skills and six projects, every claim cited
packages/knowledge     Schema, validation, build step and read-only queries
packages/mcp-server    Read-only MCP server: 6 tools, 4 resources, Streamable HTTP and stdio
packages/assistant     Provider-neutral AI assistant: chat loop over the MCP tools, Claude adapter, grounding
apps/web               Next.js terminal UI, the public /api/mcp endpoint and the /api/chat assistant
infra/bedrock          Terraform: least-privilege, OIDC-only IAM role for Claude on Amazon Bedrock
docs/MCP.md            MCP tools, resources, security and client set-up
docs/AI.md             The AI assistant: architecture, grounding, budgets, failure behaviour
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

Ask the terminal a question in plain English, or use `ask <question>`. Answers come only from the verified portfolio, via the MCP tools, with sources listed under each answer. Locally it runs on a scripted model (no keys, no cost); in production on Claude via Amazon Bedrock, within a $10/day and $50/month budget. See [docs/AI.md](docs/AI.md).

## MCP

Connect any MCP client to `https://<your-domain>/api/mcp`. For example, in Claude Code:

```bash
claude mcp add --transport http alex-portfolio https://<your-domain>/api/mcp
```

The tools are `list_projects`, `get_project`, `search_projects`, `get_profile`, `get_experience` and `get_skills`. The resources are `portfolio://profile`, `portfolio://skills`, `portfolio://projects` and `portfolio://projects/{id}`. See [docs/MCP.md](docs/MCP.md) for details, security and deployment.

## Updating content

Edit the JSON in `content/`; the schemas in `content/schemas/` give editor autocompletion. Every claim needs at least one source, and claims marked `"status": "unverified"` are kept out of everything public. `npm run knowledge:build` validates the content and regenerates the bundle that the terminal and MCP server both read.
