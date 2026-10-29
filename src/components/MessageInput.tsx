import { useState, type FormEvent } from 'react';
import type { ExecutionStatus, GuidanceStatus } from '../types';

interface MessageInputProps {
  onSend: (text: string) => void;
  onInterrupt: () => void;
  canInterrupt: boolean;
  interrupting?: boolean;
  status: ExecutionStatus;
  sending?: boolean;
  disabled?: boolean;
  guidanceStatus?: GuidanceStatus | null;
}

export function MessageInput({
  onSend,
  onInterrupt,
  canInterrupt,
  interrupting = false,
  status,
  sending = false,
  disabled = false,
  guidanceStatus = null,
}: MessageInputProps) {
  const [text, setText] = useState('');
  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const placeholder = isRunning
    ? '输入引导，将在当前步骤结束后应用…'
    : isPaused
      ? '输入新要求并继续…'
      : '输入消息…';
  let helperText: string | null = null;
  if (interrupting) {
    helperText = '正在中断当前会话…';
  } else if (guidanceStatus === 'waiting') {
    helperText = '引导已排队，将在当前步骤结束后加入上下文。';
  } else if (guidanceStatus === 'context') {
    helperText = '引导已加入上下文。';
  } else if (guidanceStatus === 'processing') {
    helperText = 'Agent 已按新的引导继续处理。';
  } else if (guidanceStatus === 'failed') {
    helperText = '引导发送失败，请重试。';
  } else if (sending) {
    helperText = '正在发送消息…';
  } else if (isRunning) {
    helperText = '输入时 Enter 换行，点击“引导”后在下一次 Agent 决策前生效。';
  } else if (isPaused) {
    helperText = '发送消息后，Agent 会按新要求继续运行。';
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled || sending || interrupting) return;
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
          className="max-h-40 min-h-14 min-w-0 flex-1 resize-y rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
        />
        <button
          type="submit"
          disabled={disabled || sending || interrupting || !text.trim()}
          className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {isRunning ? '引导' : '发送'}
        </button>
        <button
          type="button"
          onClick={onInterrupt}
          disabled={!canInterrupt || interrupting}
          aria-label={interrupting ? '正在中断当前会话' : '中断当前会话'}
          aria-busy={interrupting}
          className="flex h-10 shrink-0 items-center gap-2 rounded-lg border border-red-200 px-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-transparent"
        >
          <span aria-hidden="true" className="h-3 w-3 rounded-sm bg-current" />
          {interrupting ? '中断中…' : '中断'}
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
