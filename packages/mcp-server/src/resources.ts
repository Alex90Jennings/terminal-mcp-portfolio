import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError, type ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { renderProfileMarkdown, renderProjectIndexMarkdown, renderProjectMarkdown, renderSkillsMarkdown } from './markdown.ts';
import type { ToolContext } from './tools/shared.ts';
import { PROFILE_URI, PROJECT_URI_TEMPLATE, PROJECTS_URI, projectUri, SKILLS_URI } from './uris.ts';

/** JSON-RPC code for "resource not found" in the MCP specification. */
export const RESOURCE_NOT_FOUND = -32002;

const MARKDOWN = 'text/markdown';

/** Read-only Markdown documents. Clients can attach these to a conversation directly, without a tool call. */
export function registerResources(server: McpServer, context: ToolContext): void {
  const { kb } = context;

  const document = (uri: URL, render: () => string): ReadResourceResult => {
    try {
      return { contents: [{ uri: uri.href, mimeType: MARKDOWN, text: render() }] };
    } catch (error) {
      if (error instanceof McpError) throw error;
      context.onError(error, `resource ${uri.href}`);
      throw new McpError(ErrorCode.InternalError, 'The portfolio server could not read this resource.');
    }
  };

  server.registerResource(
    'profile',
    PROFILE_URI,
    {
      title: `${kb.profile.name}: profile`,
      description: 'Summary, employment, education, certifications, working approach and contact details, with sources.',
      mimeType: MARKDOWN,
    },
    (uri) => document(uri, () => renderProfileMarkdown(kb)),
  );

  server.registerResource(
    'skills',
    SKILLS_URI,
    { title: 'Skills', description: 'Verified technical skills grouped by category, each linked to supporting projects.', mimeType: MARKDOWN },
    (uri) => document(uri, () => renderSkillsMarkdown(kb)),
  );

  server.registerResource(
    'projects',
    PROJECTS_URI,
    { title: 'Featured projects', description: 'An index of the six featured projects, linking to each project’s document.', mimeType: MARKDOWN },
    (uri) => document(uri, () => renderProjectIndexMarkdown(kb)),
  );

  server.registerResource(
    'project',
    new ResourceTemplate(PROJECT_URI_TEMPLATE, {
      list: () => ({
        resources: kb.projects.map((project) => ({
          uri: projectUri(project.id),
          name: project.id,
          title: project.name,
          description: `${project.focus}. ${project.tagline}`,
          mimeType: MARKDOWN,
        })),
      }),
      complete: {
        id: (value) => kb.projects.map(({ id }) => id).filter((id) => id.startsWith(value.trim().toLowerCase())),
      },
    }),
    {
      title: 'Project documentation',
      description:
        'Full verified documentation for one project: overview, responsibilities with ownership, technologies, architecture (with Mermaid diagrams), ' +
        'challenges, decisions, lessons, limitations, links, gaps and footnoted sources.',
      mimeType: MARKDOWN,
    },
    (uri, { id }) =>
      document(uri, () => {
        // Canonical ids only, so each document has exactly one stable URI.
        const project = kb.projects.find((candidate) => candidate.id === id);
        if (project === undefined) throw new McpError(RESOURCE_NOT_FOUND, `Resource not found: ${uri.href}`, { uri: uri.href });
        return renderProjectMarkdown(project);
      }),
  );
}
