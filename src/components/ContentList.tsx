import type { ContentItem } from '../types';

interface ContentListProps {
  content: ContentItem[];
  imageClassName?: string;
}

export function ContentList({
  content,
  imageClassName = 'max-h-72 max-w-full rounded-lg object-contain',
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
        return (
          <div key={`text-${index}`} className="whitespace-pre-wrap">
            {item.text}
          </div>
        );
      })}
    </div>
  );
}
