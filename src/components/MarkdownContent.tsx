import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownContentProps {
  children: string;
  imageClassName: string;
}

/**
 * Renders assistant text as Markdown (GFM) with app-scoped styling.
 *
 * Styling lives under `.markdown-body` in index.css so the global element
 * rules used by the surrounding shell cannot leak into chat content.
 */
export function MarkdownContent({ children, imageClassName }: MarkdownContentProps) {
  return (
    <div className="markdown-body">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ node: _node, ...props }) => (
            <img {...props} className={imageClassName} loading="lazy" />
          ),
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
          table: ({ node: _node, ...props }) => (
            <div className="markdown-table-wrap">
              <table {...props} />
            </div>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
