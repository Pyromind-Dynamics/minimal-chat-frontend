import type { WorkflowContext } from './workflowPlan';
import type { ChatEvent, ConversationSnapshot, TimelineOperation } from './types';

export type { WorkflowContext } from './workflowPlan';
export interface WorkflowNodeDefinition {
  id: string; name: string; description: string; roles: string[]; max_instances?: number | null;
  tasks: {id: string; description: string; display_name?: string | null; requires_report?: boolean}[];
}
export interface PreparationView {
  policy: { allowed_roles: string[]; workflow_nodes: WorkflowNodeDefinition[] };
  revision: number;
  phase: 'collecting' | 'planning' | 'ready' | 'active';
  plan: WorkflowContext | null;
  entry_task?: {request_id: string} | null;
  review_pending: boolean;
  project_id: string | null;
}
export interface ProjectView {
  project_id: string; conversation_id: string; plan_sequence: number;
  plan: WorkflowContext; creation_command_id: string;
  cluster?: string | null;
}
export interface ExecutionBinding {
  project_id: string; task_run_id: string; stage_id: string; plan_sequence: number;
}
export function canCreateProject(snapshot: ConversationSnapshot): boolean {
  const preparation = snapshot.preparation;
  return !!preparation?.plan && !snapshot.project && preparation.phase === 'ready'
    && !preparation.review_pending
    && snapshot.status !== 'running' && !(snapshot.pending_inputs?.length)
    && !snapshot.experiment_queue?.length
    && snapshot.pending_permissions.length === 0;
}

export function preparationPlanStatus(snapshot: ConversationSnapshot | null) {
  const view = snapshot?.preparation;
  if (!snapshot || !view?.plan || snapshot.project) return null;
  if (snapshot.pending_inputs?.length || snapshot.pending_permissions.length) return 'input';
  if (snapshot.automatic_turns_suspended) return 'paused';
  if (snapshot.status === 'running') return 'running';
  if (snapshot.experiment_queue?.length) return 'queued';
  if (snapshot.capabilities?.read_only || snapshot.status === 'deleting' || snapshot.status === 'closed') return null;
  if (canCreateProject(snapshot)) return 'ready';
  return view.review_pending ? 'review_required' : 'incomplete';
}
const platformQueueNames: Readonly<Record<string, string>> = {
  workflow_run: '工作流任务',
  workflow_debug: '工作流调试',
  echomind_debug_repair: '工作流调试修复',
  data_preparation: '数据准备',
  data_cleaning: '数据清洗',
  environment_processing: '环境处理',
  environment_processing_render: '环境渲染',
  environment_processing_aggregate: '环境结果汇总',
};

export function projectExecutionQueue(snapshot: ConversationSnapshot): { id: string; name: string }[] {
  const project = snapshot.project;
  if (!project) return [];
  const names = new Map(project.plan.tasks?.map(task => [task.id, task.name]));
  const nextTaskPrefix = `project-continue:${project.project_id}:`;
  const queued = new Map<string, string>();

  // The runtime dispatches approved continuation tasks before other local work.
  const localQueue = (snapshot.experiment_queue ?? []).toSorted(
    (a, b) => Number(b.kind === 'project_continue') - Number(a.kind === 'project_continue'),
  );
  for (const task of localQueue) {
    switch (task.kind) {
      case 'project_start':
        if (task.task_id === `project-start:${project.project_id}`) {
          queued.set(task.task_id, names.get(snapshot.preparation?.entry_task?.request_id ?? '') ?? '启动项目');
        }
        break;
      case 'project_continue':
        if (task.task_id.startsWith(nextTaskPrefix)) {
          queued.set(task.task_id, names.get(task.task_id.slice(nextTaskPrefix.length)) ?? '继续执行项目');
        }
        break;
      case 'requirement': {
        const firstLine = task.instruction?.trim().split(/\r?\n/, 1)[0]?.trim();
        queued.set(task.task_id, firstLine && firstLine !== task.task_id ? firstLine : '处理项目需求');
        break;
      }
    }
  }

  const bound = new Map<string, string | null>();
  for (const run of snapshot.experiment_executions ?? []) {
    const currentPlan = run.project_id === project.project_id && run.plan_sequence === project.plan_sequence;
    const taskName = names.get(run.task_id) ?? run.task_name;
    for (const id of run.platform_task_ids ?? []) {
      if (currentPlan || !bound.has(id)) bound.set(id, currentPlan ? taskName : null);
    }
    if (run.platform_task_id && (currentPlan || !bound.has(run.platform_task_id))) {
      bound.set(run.platform_task_id, currentPlan ? taskName : null);
    }
  }
  for (const task of snapshot.external_tasks ?? []) {
    if (task.status !== 'pending' || queued.has(task.task_id)) continue;
    const reference = task.correlation?.execution;
    if (reference && (reference.project_id !== project.project_id || reference.plan_sequence !== project.plan_sequence)) continue;
    const boundName = bound.get(task.task_id);
    if (boundName === null && !reference) continue;
    const name = (reference ? names.get(reference.task_id) : boundName)
      ?? (task.kind && Object.hasOwn(platformQueueNames, task.kind) ? platformQueueNames[task.kind] : undefined);
    if (name) queued.set(task.task_id, name);
  }
  return Array.from(queued, ([id, name]) => ({ id, name }));
}

export function stageOperations(snapshot: ConversationSnapshot, stageId: string): TimelineOperation[] {
  return snapshot.timeline.filter((item): item is TimelineOperation => item.kind === 'operation'
    && item.category === 'subagent' && item.execution?.project_id === snapshot.project?.project_id
    && item.execution?.stage_id === stageId);
}

export function managerChatEvents(events: ChatEvent[]): ChatEvent[] {
  const children = new Set(events.flatMap(event => event.kind === 'ActionEvent' && event.category === 'subagent' ? [event.id] : []));
  return events.filter(event => event.kind === 'ActionEvent' ? !children.has(event.id)
    : event.kind === 'ObservationEvent' ? !children.has(event.action_id ?? event.tool_call_id ?? '') : true);
}
