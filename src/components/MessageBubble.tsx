import type { SnapshotMessage } from '../types';
import { ContentList } from './ContentList';

interface MessageBubbleProps {
  message: SnapshotMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  return (
    <div className={`mb-3 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
          isUser
            ? 'rounded-br-sm bg-blue-600 text-white'
            : 'rounded-bl-sm bg-gray-100 text-gray-900'
        }`}
      >
        <ContentList content={message.content} />
        {message.status === 'streaming' && (
          <span className="mt-1 inline-block h-3 w-1 animate-pulse bg-current opacity-50" />
        )}
      </div>
    </div>
  );
}
