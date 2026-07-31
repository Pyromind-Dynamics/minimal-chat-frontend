import type { MessageEvent } from '../types';
import { ContentList } from './ContentList';

interface MessageBubbleProps {
  event: MessageEvent;
}

export function MessageBubble({ event }: MessageBubbleProps) {
  const isUser = event.source === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
          isUser
            ? 'bg-blue-600 text-white rounded-br-sm'
            : 'bg-gray-100 text-gray-900 rounded-bl-sm'
        }`}
      >
        <ContentList content={event.llm_message.content} />
      </div>
    </div>
  );
}
