import type { WorkflowContext } from './workflowPlan';
import type { ChatEvent, ConversationSnapshot, TimelineOperation } from './types';
import { subagentDisplay } from './subagentPresentation.ts';

export type { WorkflowContext } from './workflowPlan';
export interface WorkflowNodeDefinition {
  id: string; name: string; description: string; roles: string[];
  tasks: {id: string; description: string; display_name?: string | null}[];
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
  return !!preparation && !snapshot.project && preparation.phase === 'ready'
    && !preparation.review_pending
    && snapshot.status !== 'running' && !(snapshot.pending_inputs?.length)
    && snapshot.pending_permissions.length === 0;
}
export function stageOperations(snapshot: ConversationSnapshot, stageId: string): TimelineOperation[] {
  return snapshot.timeline.filter((item): item is TimelineOperation => item.kind === 'operation'
    && item.category === 'subagent' && item.execution?.project_id === snapshot.project?.project_id
    && item.execution?.stage_id === stageId);
}

export function stageRunOperations(snapshot: ConversationSnapshot, stageId: string): TimelineOperation[] {
  const catalog = snapshot.preparation?.policy.workflow_nodes ?? [];
  return snapshot.timeline.filter((item): item is TimelineOperation => {
    if (item.kind !== 'operation' || item.category !== 'subagent') return false;
    if (item.execution) return item.execution.project_id === snapshot.project?.project_id
      && item.execution.stage_id === stageId;
    const role = subagentDisplay(item.details)?.role;
    if (!role) return false;
    const matches = snapshot.project?.plan.stages.filter(stage =>
      catalog.find(node => node.id === stage.kind)?.roles.includes(role)) ?? [];
    return matches.length === 1 && matches[0].id === stageId;
  });
}

export function managerChatEvents(events: ChatEvent[]): ChatEvent[] {
  const children = new Set(events.flatMap(event => event.kind === 'ActionEvent' && event.category === 'subagent' ? [event.id] : []));
  return events.filter(event => event.kind === 'ActionEvent' ? !children.has(event.id)
    : event.kind === 'ObservationEvent' ? !children.has(event.action_id ?? event.tool_call_id ?? '') : true);
}
