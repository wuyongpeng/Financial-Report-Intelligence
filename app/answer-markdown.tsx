'use client';

import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseFilingHref } from '@/lib/answer-cite';

function injectText(node: ReactNode, renderCites: (chunk: string) => ReactNode): ReactNode {
  return Children.map(node, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      const value = String(child);
      if (!/【|\[P\d+\]/.test(value)) return child;
      return renderCites(value);
    }
    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children != null) {
      return cloneElement(child, { children: injectText(child.props.children, renderCites) });
    }
    return child;
  });
}

function safeUrl(url: string) {
  return /^https?:\/\//i.test(url) ? url : '';
}

function textOf(children: ReactNode): string {
  return Children.toArray(children).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    if (isValidElement<{ children?: ReactNode }>(child)) return textOf(child.props.children);
    return '';
  }).join('');
}

export default function AnswerMarkdown({
  text,
  renderCites,
  onFilingJump,
}: {
  text: string;
  renderCites: (chunk: string) => ReactNode;
  onFilingJump?: (target: { href: string; label: string }) => void;
}) {
  const cites = (children: ReactNode) => injectText(children, renderCites);
  return (
    <div className="cd-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (parseFilingHref(url) ? url : safeUrl(url))}
        components={{
          p: ({ children }) => <p>{cites(children)}</p>,
          li: ({ children }) => <li>{cites(children)}</li>,
          td: ({ children }) => <td>{cites(children)}</td>,
          th: ({ children }) => <th>{cites(children)}</th>,
          h1: ({ children }) => <h3>{cites(children)}</h3>,
          h2: ({ children }) => <h3>{cites(children)}</h3>,
          h3: ({ children }) => <h4>{cites(children)}</h4>,
          h4: ({ children }) => <h4>{cites(children)}</h4>,
          h5: ({ children }) => <h4>{cites(children)}</h4>,
          h6: ({ children }) => <h4>{cites(children)}</h4>,
          blockquote: ({ children }) => <blockquote>{cites(children)}</blockquote>,
          a: ({ href, children }) => {
            const labelText = textOf(children).trim();
            const visible = !labelText || labelText === '?' ? null : cites(children);
            const filing = href ? parseFilingHref(href) : null;
            if (filing && onFilingJump) {
              return (
                <button
                  type="button"
                  className="cd-md-filing"
                  onClick={() => onFilingJump({
                    href: href!,
                    label: labelText && labelText !== '?' ? labelText : `${filing.code}${filing.period ? ` ${filing.period}` : ''}`,
                  })}
                >
                  {visible ?? `[${filing.period ?? filing.code}]`}
                </button>
              );
            }
            const url = href ? safeUrl(href) : '';
            if (!url) return visible;
            return <a href={url} target="_blank" rel="noreferrer noopener" className="cd-md-link">{visible ?? '来源'}</a>;
          },
          table: ({ children }) => <div className="cd-md-table"><table>{children}</table></div>,
          hr: () => <hr />,
          strong: ({ children }) => <strong>{cites(children)}</strong>,
          em: ({ children }) => <em>{cites(children)}</em>,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
