import type { TimelineOperation } from './types';

export interface SubagentDisplay {
  version: 1;
  run_id?: string;
  role?: string;
  task?: string;
  phase?: string;
  tool_call_id?: string;
  previous_run_id?: string;
  status?: string;
  started_at?: string;
  ended_at?: string;
  trace?: {
    text: string;
    availability: string;
    truncated?: boolean;
    updated_at?: string;
    line_limit?: number;
    byte_limit?: number;
  };
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
export function subagentDisplay(details: unknown): SubagentDisplay | undefined {
  const value = object(object(details).subagent);
  return value.version === 1 ? value as unknown as SubagentDisplay : undefined;
}
const statusLabels: Record<string, string> = {
  running: '运行中', queued: '排队中', paused: '已暂停', unknown: '状态未确认',
  complete: '本轮已结束', completed: '本轮已结束', failed: '失败', stopped: '已停止',
  canceled: '已取消', cancelled: '已取消', interrupted: '已中断', timed_out: '已超时',
};

export function subagentStatus(details: unknown, status?: string, error?: string | null): string {
  const observed = subagentDisplay(details)?.status;
  if (status === 'completed') return 'completed';
  if (status === 'failed') {
    const reason = error?.replace(/^subagent_/, '') ?? observed;
    return reason && !['queued', 'running', 'unknown'].includes(reason) && Object.hasOwn(statusLabels, reason)
      ? reason : 'failed';
  }
  return observed && Object.hasOwn(statusLabels, observed) ? observed : 'unknown';
}

export function subagentStatusLabel(status: string): string {
  return statusLabels[status] ?? statusLabels.unknown;
}

export function readableResult(text: string): string {
  try {
    const content = object(JSON.parse(text)).content;
    if (Array.isArray(content)) return content.map(object)
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text).join('\n');
  } catch { /* Ordinary text. */ }
  return text;
}
export function groupSubagentOperations(operations: TimelineOperation[]) {
  const hidden = new Set<string>();
  const related = new Map<string, TimelineOperation[]>();
  const children = operations.filter(item => item.category === 'subagent');
  const runs = new Map<string, TimelineOperation[]>();
  const roots = new Map<string, string>();
  const byRunId = new Map(children.flatMap(item => {
    const id = subagentDisplay(item.details)?.run_id;
    return id ? [[id, item] as const] : [];
  }));
  for (const child of [...children].sort((a, b) => a.started_seq - b.started_seq)) {
    const display = subagentDisplay(child.details);
    const previous = display?.previous_run_id ? byRunId.get(display.previous_run_id) : undefined;
    const linked = previous && previous.started_seq < child.started_seq
      && (subagentDisplay(previous.details)?.role ?? previous.name) === (display?.role ?? child.name);
    const root = linked ? roots.get(previous.item_id) ?? previous.item_id : child.item_id;
    roots.set(child.item_id, root);
    runs.set(root, [...runs.get(root) ?? [], child]);
    if (root !== child.item_id) hidden.add(child.item_id);
  }
  for (const child of children) {
    const display = subagentDisplay(child.details);
    if (!display) continue;
    const matches = operations.filter(item => {
      if (item.category !== 'tool') return false;
      if (item.item_id === display.tool_call_id) return true;
      const args = object(item.arguments);
      return item.name === 'subagent' && typeof display.run_id === 'string'
        && args.id === display.run_id && ['status', 'stop'].includes(String(args.action));
    });
    matches.forEach(item => hidden.add(item.item_id));
    related.set(child.item_id, matches);
  }
  return { hidden, related, runs };
}
