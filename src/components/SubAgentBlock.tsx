import { useEffect, useState, type ReactNode } from 'react';
import type {
  ActionEvent,
  ObservationEvent,
  SubAgentObservation,
  SubAgentType,
} from '../types';

interface SubAgentBlockProps {
  action: ActionEvent;
  observation?: ObservationEvent;
}

const TYPE_LABELS: Record<SubAgentType, string> = {
  search: '知识检索',
  general_purpose: '通用任务',
};

export function SubAgentBlock({ action, observation }: SubAgentBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const args = parseToolArgs(action.tool_call.arguments);
  const type = parseSubAgentType(args.type);
  const task = typeof args.task === 'string' ? args.task : '未提供任务说明';
  const result = getSubAgentObservation(observation);
  const isRunning = !observation;
  const isError = Boolean(observation?.observation.is_error)
    || (result !== null && result.status !== 'completed');
  const duration = formatDuration(
    Date.parse(action.timestamp),
    observation ? Date.parse(observation.timestamp) : now,
  );

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  const statusLabel = isRunning ? '运行中' : isError ? '失败' : '已完成';
  const statusStyle = isRunning
    ? 'bg-blue-50 text-blue-700 ring-blue-200'
    : isError
      ? 'bg-red-50 text-red-700 ring-red-200'
      : 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  const accentStyle = type === 'search'
    ? 'border-cyan-300 bg-cyan-50/40'
    : 'border-violet-300 bg-violet-50/40';

  return (
    <section
      aria-label={`子 Agent：${TYPE_LABELS[type]}`}
      className={`mb-3 ml-2 overflow-hidden rounded-xl border ${accentStyle}`}
    >
      <div className="px-3.5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-800">子 Agent</span>
              <span className="text-xs text-gray-500">· {TYPE_LABELS[type]}</span>
            </div>
            <p className="mt-1 break-words text-sm leading-5 text-gray-800">{task}</p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium ring-1 ring-inset ${statusStyle}`}
          >
            {isRunning && (
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 animate-spin rounded-full border border-blue-300 border-t-blue-700"
              />
            )}
            {!isRunning && (
              <span aria-hidden="true">{isError ? '×' : '✓'}</span>
            )}
            {statusLabel}
          </span>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-500">
          <span>
            {isRunning
              ? type === 'search'
                ? '正在查询知识库索引…'
                : '正在处理多步骤任务…'
              : `${statusLabel} · ${duration}`}
          </span>
          {!isRunning && (
            <button
              type="button"
              aria-expanded={isExpanded}
              onClick={() => setIsExpanded((current) => !current)}
              className="shrink-0 font-medium text-gray-600 hover:text-gray-900"
            >
              {isExpanded ? '收起详情' : '查看详情'}
            </button>
          )}
        </div>
      </div>

      {isExpanded && result && (
        <div className="space-y-3 border-t border-gray-200/80 bg-white/80 px-3.5 py-3">
          <Detail title="任务">
            <p className="whitespace-pre-wrap break-words">{task}</p>
          </Detail>
          <Detail title={isError ? '错误' : '结果'}>
            <p
              className={`whitespace-pre-wrap break-words ${isError ? 'text-red-700' : ''}`}
            >
              {getObservationText(observation) || '子 Agent 没有返回文本结果。'}
            </p>
          </Detail>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-gray-400">
            <span>task {result.task_id}</span>
            {result.child_conversation_id && (
              <span>child {result.child_conversation_id}</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Detail({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="text-xs leading-5 text-gray-700">
      <p className="mb-1 font-semibold text-gray-500">{title}</p>
      {children}
    </div>
  );
}

function parseSubAgentType(value: unknown): SubAgentType {
  return value === 'search' ? 'search' : 'general_purpose';
}

function parseToolArgs(
  args: Record<string, unknown> | string,
): Record<string, unknown> {
  if (typeof args !== 'string') return args;
  try {
    const parsed = JSON.parse(args) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return { task: args };
  }
  return {};
}

function getSubAgentObservation(
  event: ObservationEvent | undefined,
): SubAgentObservation | null {
  if (!event) return null;
  const value = event.observation as Partial<SubAgentObservation>;
  if (typeof value.task_id !== 'string' || typeof value.status !== 'string') {
    return null;
  }
  return value as SubAgentObservation;
}

function getObservationText(event: ObservationEvent | undefined): string {
  if (!event) return '';
  const content = event.observation.to_llm_content ?? event.observation.content;
  if (content) {
    return content
      .filter((item) => item.type === 'text')
      .map((item) => (item as { type: 'text'; text: string }).text)
      .join('\n')
      .trim();
  }
  return '';
}

function formatDuration(start: number, end: number): string {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—';
  const seconds = Math.max(0, Math.round((end - start) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
