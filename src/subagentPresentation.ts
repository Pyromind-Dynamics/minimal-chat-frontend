import type { TimelineOperation } from './types';

export interface SubagentDisplay {
  version: 1;
  run_id?: string;
  role?: string;
  task?: string;
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
  return { hidden, related };
}
