import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ResourceLink, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { KnowledgeBase, PortfolioProject } from '@portfolio/knowledge';
import { projectUri } from '../uris.ts';

export interface ToolContext {
  kb: KnowledgeBase;
  /** Called with unexpected errors; never shown to clients. */
  onError: (error: unknown, where: string) => void;
}

/** A tool is one module that registers itself; the server lists them in one place. */
export interface ToolModule {
  name: string;
  register(server: McpServer, context: ToolContext): void;
}

/** Every tool reads a frozen, in-memory knowledge base: no writes, no side effects, no outside world. */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Structured content plus the same JSON as text, for clients that don't read `structuredContent`. */
export function success(structured: Record<string, unknown>, links: ResourceLink[] = []): CallToolResult {
  return { structuredContent: structured, content: [{ type: 'text', text: JSON.stringify(structured) }, ...links] };
}

export function failure(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export function projectLink(project: PortfolioProject): ResourceLink {
  return {
    type: 'resource_link',
    uri: projectUri(project.id),
    name: project.id,
    title: `${project.name}: full documentation`,
    description: project.tagline,
    mimeType: 'text/markdown',
  };
}

/** An unknown project is a tool error the model can recover from, so it lists the valid choices. */
export function unknownProject(kb: KnowledgeBase, input: string): CallToolResult {
  const suggestions = kb.suggestProjectIds(input);
  const valid = kb.projects.map(({ id }) => id).join(', ');
  return failure(
    `No project matches "${input}".${suggestions.length > 0 ? ` Did you mean ${suggestions.join(' or ')}?` : ''} ` +
      `Valid projects: ${valid} (or a listing number 1–${kb.projects.length}).`,
  );
}

/**
 * The SDK turns a thrown error into a result containing its raw message, which
 * could leak internals. Handlers run inside this guard instead.
 */
export function guarded<Args extends unknown[]>(
  where: string,
  context: ToolContext,
  handler: (...args: Args) => CallToolResult,
): (...args: Args) => CallToolResult {
  return (...args) => {
    try {
      return handler(...args);
    } catch (error) {
      context.onError(error, where);
      return failure('The portfolio server could not complete this request. Please try again.');
    }
  };
}
