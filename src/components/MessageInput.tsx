import { useState, type FormEvent } from 'react';
import type { ConversationStatus, GuidanceStatus } from '../types';

interface MessageInputProps {
  onSend: (text: string) => void;
  status: ConversationStatus;
  sending?: boolean;
  disabled?: boolean;
  canSteer?: boolean;
  guidanceStatus?: GuidanceStatus | null;
}

export function MessageInput({
  onSend,
  status,
  sending = false,
  disabled = false,
  canSteer = false,
  guidanceStatus = null,
}: MessageInputProps) {
  const [text, setText] = useState('');
  const isSteering = status === 'running' && canSteer;
  const placeholder = isSteering ? '输入对当前运行的引导…' : '输入消息…';
  const helperText = guidanceStatus === 'waiting'
    ? '引导已排队。'
    : guidanceStatus === 'context'
      ? '引导已加入上下文。'
      : guidanceStatus === 'processing'
        ? 'Agent 已按新的引导继续处理。'
        : guidanceStatus === 'failed'
          ? '引导发送失败，请重试。'
          : sending
            ? '正在发送消息…'
            : status === 'running' && !canSteer
              ? '当前 Harness 不支持运行中追加引导。'
              : null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled || sending) return;
    onSend(trimmed);
    setText('');
  };

  return (
    <form onSubmit={handleSubmit} className="border-t bg-white p-4">
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          rows={2}
          className="max-h-40 min-h-14 flex-1 resize-y rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
        />
        <button
          type="submit"
          disabled={disabled || sending || !text.trim()}
          className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
        >
          {isSteering ? '引导' : '发送'}
        </button>
      </div>
      {helperText && (
        <p role="status" aria-live="polite" className="mt-2 text-xs text-gray-500">
          {helperText}
        </p>
      )}
    </form>
  );
}
