import { useMemo } from 'react';
import type { TimelineOperation } from '../types';
import type { RequestOptions } from '../api';
import { stageAgentEvents } from '../stageAgentEvents';
import { ChatPanel } from './ChatPanel';

export function StageAgentConversation({operations, status, requestOptions}: {
  operations: readonly TimelineOperation[]; status?: string; requestOptions: RequestOptions;
}) {
  const activity = useMemo(() => stageAgentEvents(operations), [operations]);
  return <section aria-label="子 Agent 会话" className="flex h-80 min-h-0 flex-col overflow-hidden rounded-lg border bg-white">
    <header className="flex items-center justify-between gap-2 border-b bg-slate-50 px-3 py-2 text-xs">
      <span className="font-medium text-slate-700">子 Agent</span>
      {status && <span className="text-slate-500">{status}</span>}
    </header>
    {activity.truncated && <p className="shrink-0 px-3 pt-2 text-[10px] text-slate-400">仅展示最近的会话窗口。</p>}
    <ChatPanel events={activity.events} requestOptions={requestOptions} status="idle" autoScroll="follow" logLabel="子 Agent 会话日志" emptyText="等待子 Agent 消息…" />
  </section>;
}
