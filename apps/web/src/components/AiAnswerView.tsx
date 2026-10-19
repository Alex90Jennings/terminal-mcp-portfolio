import type { AiAnswer } from '@/lib/ai-answer';
import { OutputBlocks } from './OutputBlocks';

const TOOL_MARK = { running: '…', done: '✓', error: '✗' } as const;
const TOOL_STATUS = { running: 'looking up', done: 'looked up', error: 'could not look up' } as const;

/**
 * One AI answer. While it streams, the text is hidden from assistive
 * technology (it would be read out word by word); the terminal announces the
 * finished answer once instead.
 */
export function AiAnswerView({ answer, onCommand }: { answer: AiAnswer; onCommand: (command: string) => void }) {
  const streaming = answer.status === 'waiting' || answer.status === 'streaming';
  return (
    <div className="space-y-1.5" aria-busy={streaming}>
      {answer.tools.length > 0 && (
        <ul className="space-y-0.5 text-sm text-term-muted" aria-label="Portfolio lookups">
          {answer.tools.map((tool) => (
            <li key={tool.label}>
              <span aria-hidden="true">{TOOL_MARK[tool.status]} </span>
              <span className="sr-only">{TOOL_STATUS[tool.status]}: </span>
              {tool.label}
            </li>
          ))}
        </ul>
      )}

      {answer.status === 'waiting' && answer.tools.length === 0 && <p className="text-term-muted">Thinking…</p>}

      {answer.text !== '' && (
        <p className="whitespace-pre-wrap" aria-hidden={streaming || undefined}>
          {answer.text}
          {streaming && <span aria-hidden="true" className="text-term-accent">▍</span>}
        </p>
      )}

      {answer.notices.map((notice) => (
        <p key={notice} className="text-term-muted">
          {notice}
        </p>
      ))}

      {answer.status === 'cancelled' && <p className="text-term-muted">Stopped.</p>}
      {(answer.status === 'error' || answer.status === 'unavailable') && answer.message && <p className="text-term-error">{answer.message}</p>}
      {answer.status === 'unavailable' && <OutputBlocks blocks={answer.fallback.slice(1)} onCommand={onCommand} />}

      {answer.status === 'done' && answer.projects.length > 0 && (
        <p>
          <span className="text-term-muted">Projects: </span>
          {answer.projects.map((project, index) => (
            <span key={project.id}>
              {index > 0 && <span className="text-term-muted"> · </span>}
              <button type="button" className="term-command" title={`Run “projects ${project.id}”`} onClick={() => onCommand(`projects ${project.id}`)}>
                {project.name}
              </button>
            </span>
          ))}
        </p>
      )}

      {answer.status === 'done' && answer.sources.length > 0 && (
        <div>
          <p className="text-term-muted">Sources:</p>
          {/* eslint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops list semantics when list-style is none */}
          <ul role="list" className="space-y-0.5">
            {answer.sources.map((source) => (
              <li key={`${source.label}|${source.url ?? ''}`} className="flex gap-2">
                <span aria-hidden="true" className="text-term-muted">–</span>
                {source.url ? (
                  <a href={source.url} className="term-link" target="_blank" rel="noopener noreferrer">
                    {source.label}
                    <span aria-hidden="true"> ↗</span>
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <span>{source.label}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
