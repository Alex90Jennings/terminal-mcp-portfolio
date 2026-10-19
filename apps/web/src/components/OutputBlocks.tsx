import { Fragment, type ReactNode } from 'react';
import type { Block, Inline, ListItem, Tone } from '@/terminal/output';

interface Props {
  blocks: readonly Block[];
  onCommand: (command: string) => void;
}

const TONE_CLASS: Record<Tone, string> = {
  default: '',
  muted: 'text-term-muted',
  accent: 'text-term-accent',
  error: 'text-term-error',
};

/** Renders command output as semantic HTML: headings, lists, links and buttons. */
export function OutputBlocks({ blocks, onCommand }: Props) {
  return (
    <>
      {blocks.map((block, index) => (
        <OutputBlock key={index} block={block} onCommand={onCommand} />
      ))}
    </>
  );
}

function OutputBlock({ block, onCommand }: { block: Block; onCommand: Props['onCommand'] }) {
  const inline = (content: readonly Inline[]) => <InlineContent content={content} onCommand={onCommand} />;
  switch (block.kind) {
    case 'title':
      return <h1 className="text-xl font-bold tracking-wide text-term-text uppercase sm:text-2xl">{block.text}</h1>;
    case 'heading':
      return <h2 className="mt-1 font-bold tracking-wider text-term-accent uppercase">{block.text}</h2>;
    case 'subheading':
      return <h3 className="mt-3 font-bold text-term-text">{block.text}</h3>;
    case 'paragraph':
      return <p className={TONE_CLASS[block.tone ?? 'default']}>{inline(block.content)}</p>;
    case 'list':
      return <OutputList items={block.items} ordered={block.ordered ?? false} onCommand={onCommand} />;
    case 'definitions':
      return (
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(10rem,max-content)_1fr]">
          {block.rows.map((row, index) => (
            <div key={index} className="contents">
              <dt className="font-bold text-term-text">{inline(row.term)}</dt>
              <dd className="mb-1 pl-4 sm:mb-0 sm:pl-0">{inline(row.detail)}</dd>
            </div>
          ))}
        </dl>
      );
  }
}

function OutputList({ items, ordered, onCommand }: { items: readonly ListItem[]; ordered: boolean; onCommand: Props['onCommand'] }) {
  const List = ordered ? 'ol' : 'ul';
  return (
    <List className="space-y-1" role="list">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2">
          <span aria-hidden="true" className="shrink-0 text-term-muted">
            {item.marker ?? (ordered ? `${index + 1}.` : '–')}
          </span>
          <span className="min-w-0">
            {item.lines.map((line, lineIndex) => (
              <span key={lineIndex} className="block">
                <InlineContent content={line} onCommand={onCommand} />
              </span>
            ))}
          </span>
        </li>
      ))}
    </List>
  );
}

function InlineContent({ content, onCommand }: { content: readonly Inline[]; onCommand: Props['onCommand'] }) {
  return (
    <>
      {content.map((item, index) => (
        <Fragment key={index}>{renderInline(item, onCommand)}</Fragment>
      ))}
    </>
  );
}

function renderInline(item: Inline, onCommand: Props['onCommand']): ReactNode {
  if (typeof item === 'string') return item;
  if ('href' in item) {
    const external = /^https?:/.test(item.href);
    return (
      <a
        href={item.href}
        className="term-link"
        {...(external && { target: '_blank', rel: 'noopener noreferrer' })}
      >
        {item.text}
        {external && (
          <>
            <span aria-hidden="true"> ↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </>
        )}
      </a>
    );
  }
  if ('command' in item) {
    return (
      <button type="button" className="term-command" title={`Run “${item.command}”`} onClick={() => onCommand(item.command)}>
        {item.text}
      </button>
    );
  }
  const className = [TONE_CLASS[item.tone ?? 'default'], item.strong ? 'font-bold' : ''].filter(Boolean).join(' ');
  return className ? <span className={className}>{item.text}</span> : item.text;
}
