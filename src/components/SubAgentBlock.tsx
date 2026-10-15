import { useEffect, useRef, useState } from 'react';
import type { ActionEvent, ObservationEvent } from '../types';
import { object, readableResult, subagentDisplay } from '../subagentPresentation';
import { ContentList } from './ContentList';

export function SubAgentBlock({ action, observation }: {
  action: ActionEvent; observation?: ObservationEvent;
}) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const display = subagentDisplay(action.details);
  const args = object(action.tool_call.arguments);
  const role = display?.role ?? (typeof args.agent === 'string' ? args.agent : action.tool_call.name);
  const task = display?.task ?? (typeof args.task === 'string' ? args.task : '未记录任务说明');
  const operationStatus = observation?.observation.operation_status;
  const terminalReason = observation?.observation.error_code?.replace(/^subagent_/, '');
  const status = operationStatus === 'failed' ? terminalReason ?? 'failed'
    : operationStatus === 'completed' ? 'completed' : display?.status ?? operationStatus ?? 'running';
  const running = ['running', 'queued'].includes(status);
  const labels: Record<string, string> = { running: '运行中', queued: '排队中', complete: '已完成', completed: '已完成',
    cancelled: '已取消', canceled: '已取消', stopped: '已停止', interrupted: '已中断', paused: '已暂停', timed_out: '已超时', failed: '失败' };
  const statusLabel = labels[status] ?? status;
  const failed = status === 'failed';
  const trace = display?.trace;
  const output = readableResult((observation?.observation.to_llm_content ?? [])
    .filter(item => item.type === 'text').map(item => item.text).join('\n'));
  const start = Date.parse(display?.started_at ?? action.timestamp);
  const end = running ? now : Date.parse(display?.ended_at ?? observation?.timestamp ?? '');
  const duration = Number.isFinite(start) && Number.isFinite(end) ? `${Math.max(0, Math.floor((end - start) / 1000))}s` : '—';

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  useEffect(() => {
    if (expanded && follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [trace?.text, expanded]);

  return <section aria-label={`子 Agent：${role}`} className="mb-3 ml-2 text-left overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}
      className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-100/70">
      <span aria-hidden="true" className="mt-0.5 text-slate-400">{expanded ? '▾' : '▸'}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs"><span className="font-semibold text-slate-800">子 Agent · {role}</span>
          <span className={failed ? 'text-red-600' : running ? 'text-blue-600' : 'text-slate-500'}>{statusLabel}</span>
          <span className="ml-auto text-slate-400">{duration}</span></div>
        <p className="mt-1 line-clamp-2 break-words text-sm text-slate-700">{task}</p>
      </div>
    </button>
    {expanded && <div className="space-y-4 border-t border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-700">
      {display?.previous_run_id && <p className="break-all text-slate-500">继续自运行 {display.previous_run_id}</p>}
      <div><h4 className="mb-1 font-semibold">执行过程 <span className="font-normal text-slate-400">· 最近轨迹窗口</span></h4>
        {trace?.truncated && <p className="mb-1 text-amber-700">轨迹已截断，仅展示最近的有界窗口。</p>}
        {trace?.text ? <div ref={scroll} onScroll={() => {
          const el = scroll.current;
          if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }} className="max-h-80 overflow-auto rounded-lg bg-slate-50 p-3">
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">{trace.text}</pre>
        </div> : <p className="text-slate-400">{running ? '等待可展示轨迹…' : '该次运行未记录可展示轨迹'}</p>}
        {trace?.updated_at && <p className="mt-1 text-slate-400">更新于 {new Date(trace.updated_at).toLocaleTimeString()} · 最多 {trace.line_limit ?? 200} 行 / 32 KiB</p>}
      </div>
      <div><h4 className="mb-1 font-semibold">结果</h4>
        <ContentList content={[{ type: 'text', text: output || (running ? '任务进行中，尚无最终结果。' : '未记录最终文本结果。') }]} markdown />
      </div>
      {!!action.related_operations?.length && <details className="text-slate-500"><summary className="cursor-pointer">委派与控制记录</summary>
        {action.related_operations.map(item => <div key={item.item_id} className="mt-2 border-l-2 border-slate-200 pl-2">
          <p>{String(object(item.arguments).action ?? '委派')} · {item.status}</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{item.output.filter(block => block.type === 'text').map(block => readableResult(block.text)).join('\n')}</pre>
        </div>)}
      </details>}
      {display?.run_id && <p className="break-all font-mono text-[10px] text-slate-400">run {display.run_id}</p>}
    </div>}
  </section>;
}
