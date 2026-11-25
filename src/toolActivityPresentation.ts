import { getUserInputInterruption } from './toolErrorPresentation.ts';
import type { ActionEvent, ChatEvent, ObservationEvent } from './types';

const toolActivities: Record<string, string> = {
  read: '读取文件',
  search: '搜索',
  grep: '搜索',
  glob: '搜索',
  find: '搜索',
  ls: '查看目录',
  write: '写入文件',
  edit: '编辑文件',
  terminal: '运行命令',
  bash: '运行命令',
  df_check_progress: '查询任务进度',
  inspect_workflow_task: '查询任务进度',
  get_echomind_status: '查询项目状态',
  read_echomind_report: '读取项目报告',
  queue_echomind_requirement: '提交需求',
  df_submit_evaluation: '提交评测',
  df_submit_pipeline: '提交数据处理',
  submit_workflow: '提交工作流',
  set_preparation_plan: '更新项目计划',
  ask_user: '询问用户',
};

export function summarizeToolActivity(events: ChatEvent[]): { text: string; status: 'running' | 'waiting' | 'finished' } | null {
  const observations = observationsFor(events);
  const completed = new Map<string, number>();
  let current: string | undefined;
  let running = 0;
  let executing = false;
  let failed = 0;
  let interrupted = 0;
  for (const event of events) {
    if (event.kind !== 'ActionEvent') continue;
    const observation = observations.get(event.id)?.observation;
    const label = activityLabel(event);
    if (observation && (getUserInputInterruption(event.tool_call.name, observation)
      || ('status' in observation && observation.status === 'cancelled'))) {
      interrupted++;
    } else if (observation?.is_error || observation?.operation_status === 'failed') {
      failed++;
    } else if (!observation || observation.operation_status === 'running') {
      const waiting = event.tool_call.name === 'ask_user';
      current = waiting ? '等待用户回复' : `正在${label}`;
      running++;
      executing ||= !waiting;
    } else {
      completed.set(label, (completed.get(label) ?? 0) + 1);
    }
  }

  if (current) return { text: running > 1 ? `${current}等 ${running} 项操作…` : `${current}…`, status: executing ? 'running' : 'waiting' };

  const categories = [...completed].sort((left, right) => right[1] - left[1]);
  const parts = categories.slice(0, 2).map(([label, count]) => `${label} ${count} 次`);
  const other = categories.slice(2).reduce((sum, [, count]) => sum + count, 0);
  if (other) parts.push(`其他 ${other} 次`);
  if (failed) parts.push(`${parts.length ? '' : '工具调用'}失败 ${failed} 次`);
  if (interrupted) parts.push(`${parts.length ? '' : '工具调用'}中断 ${interrupted} 次`);
  return parts.length ? { text: parts.join(' · '), status: 'finished' } : null;
}

function activityLabel(event: ActionEvent): string {
  const { name, arguments: raw } = event.tool_call;
  if (name === 'training_analysis') {
    return parseToolArgs(raw).operation === 'report' ? '查询训练报告' : '分析训练结果';
  }
  if (name === 'product_versions') {
    const args = parseToolArgs(raw);
    if (args.action === 'read') return '读取项目产物';
    if (args.action === 'save') return '登记项目产物';
    if (args.action === 'list') return '查询项目版本';
    return '管理项目版本';
  }
  return Object.hasOwn(toolActivities, name) ? toolActivities[name] : '调用工具';
}

export function observationsFor(events: ChatEvent[]): Map<string, ObservationEvent> {
  const byActionId = new Map<string, ObservationEvent>();
  for (const event of events) {
    if (event.kind === 'ObservationEvent' && event.action_id) byActionId.set(event.action_id, event);
  }
  return byActionId;
}

export function parseToolArgs(args: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof args !== 'string') return args;
  try {
    const parsed = JSON.parse(args) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return { arguments: args };
  }
  return { arguments: args };
}
