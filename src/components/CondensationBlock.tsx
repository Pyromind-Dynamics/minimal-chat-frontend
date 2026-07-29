import type { CondensationEvent } from '../types';

interface CondensationBlockProps {
  event: CondensationEvent;
}

export function CondensationBlock({ event }: CondensationBlockProps) {
  return (
    <div className="mb-3 ml-2 border-l-2 border-slate-300 pl-3 text-xs text-slate-600">
      <div className="font-medium text-slate-700">上下文已压缩</div>
      <div className="mt-1">
        已将 {event.forgotten_event_ids.length} 条历史事件替换为摘要
      </div>
      <div className="mt-1 break-all font-mono text-[11px] text-slate-400 select-all">
        Event ID: {event.id}
      </div>
      {event.summary && (
        <details className="mt-2">
          <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
            查看压缩摘要
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[11px] text-slate-600">
            {event.summary}
          </pre>
        </details>
      )}
    </div>
  );
}
