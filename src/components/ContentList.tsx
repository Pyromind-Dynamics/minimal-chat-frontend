import Markdown from 'react-markdown';
import type { ContentItem } from '../types';

interface ContentListProps {
  content: ContentItem[];
  imageClassName?: string;
  markdown?: boolean;
}

export function ContentList({
  content,
  imageClassName = 'max-h-72 max-w-full rounded-lg object-contain',
  markdown = false,
}: ContentListProps) {
  return (
    <div className="space-y-2">
      {content.map((item, index) => {
        if (item.type === 'image') {
          return item.image_urls.map((url, imageIndex) => (
            <img
              key={`image-${index}-${imageIndex}`}
              src={url}
              alt={`Sample preview ${index + imageIndex + 1}`}
              className={imageClassName}
              loading="lazy"
            />
          ));
        }
        if (item.type === 'image_url') {
          return (
            <img
              key={`image-${index}`}
              src={item.image_url.url}
              alt={`Sample preview ${index + 1}`}
              className={imageClassName}
              loading="lazy"
            />
          );
        }
        if (markdown) {
          return (
            <div key={`text-${index}`} className="space-y-2 whitespace-normal break-words">
              <Markdown
                skipHtml
                components={{
                  img: ({ node: _node, ...props }) => (
                    <img {...props} className={imageClassName} loading="lazy" />
                  ),
                  pre: ({ node: _node, ...props }) => (
                    <pre {...props} className="overflow-x-auto whitespace-pre rounded bg-gray-200 p-2" />
                  ),
                }}
              >
                {item.text}
              </Markdown>
            </div>
          );
        }
        return (
          <div key={`text-${index}`} className="whitespace-pre-wrap">
            {item.text}
          </div>
        );
      })}
    </div>
  );
}
