import type { ContentBlock } from '../types';

interface ContentListProps {
  content: ContentBlock[];
  imageClassName?: string;
}

export function ContentList({
  content,
  imageClassName = 'max-h-72 max-w-full rounded-lg object-contain',
}: ContentListProps) {
  return (
    <div className="space-y-2">
      {content.map((item, index) => {
        if (item.type === 'text') {
          return (
            <div key={`text-${index}`} className="whitespace-pre-wrap">
              {item.text}
            </div>
          );
        }
        if (item.type === 'image') {
          const source = item.data.startsWith('data:') || item.data.startsWith('http')
            ? item.data
            : `data:${item.mime_type};base64,${item.data}`;
          return (
            <img
              key={`image-${index}`}
              src={source}
              alt={`Content ${index + 1}`}
              className={imageClassName}
              loading="lazy"
            />
          );
        }
        if (item.text) {
          return (
            <div key={`resource-${index}`} className="whitespace-pre-wrap">
              {item.text}
            </div>
          );
        }
        if (isImageResource(item.uri, item.mime_type)) {
          return (
            <img
              key={`resource-image-${index}`}
              src={item.uri}
              alt={`Resource ${index + 1}`}
              className={imageClassName}
              loading="lazy"
            />
          );
        }
        return (
          <a
            key={`resource-${index}`}
            href={item.uri}
            target="_blank"
            rel="noreferrer"
            className="break-all text-blue-600 underline"
          >
            {item.uri}
          </a>
        );
      })}
    </div>
  );
}

function isImageResource(uri: string, mimeType?: string | null): boolean {
  return Boolean(
    mimeType?.startsWith('image/')
    || uri.startsWith('data:image/')
    || /\.(png|jpe?g|gif|webp|svg)(?:\?|$)/i.test(uri),
  );
}
