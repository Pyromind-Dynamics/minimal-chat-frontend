import type { MessageEvent } from '../types';
import { ContentList } from './ContentList';

const messageTimeFormat = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

interface MessageBubbleProps {
  event: MessageEvent;
}

export function MessageBubble({ event }: MessageBubbleProps) {
  const isUser = event.source === 'user';
  const timestamp = Date.parse(event.timestamp);
  return (
    <div className={`mb-3 flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
          isUser
            ? 'bg-blue-600 text-white rounded-br-sm'
            : 'bg-gray-100 text-gray-900 rounded-bl-sm'
        }`}
      >
        <ContentList content={event.llm_message.content} markdown={!isUser} />
        {event.delivery_status && (
          <div
            className={`mt-1 text-[10px] ${isUser ? 'text-blue-100' : 'text-gray-400'}`}
          >
            {event.delivery_status === 'pending' ? 'Sending…' : event.delivery_status === 'acknowledged' ? '已接收，等待处理' : 'Failed to send'}
          </div>
        )}
      </div>
      {Number.isFinite(timestamp) && (
        <time dateTime={new Date(timestamp).toISOString()} className="mt-1 px-1 text-[11px] tabular-nums text-slate-600">
          {messageTimeFormat.format(timestamp)}
        </time>
      )}
    </div>
  );
}
