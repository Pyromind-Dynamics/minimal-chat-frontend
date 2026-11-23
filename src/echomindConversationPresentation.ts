import type { ChatEvent, ConversationSnapshot, MessageEvent } from './types';
import { executionProgressLabel, type ExperimentExecution } from './experimentExecutions.ts';

export function hasVisibleMessage(event: ChatEvent): event is MessageEvent {
  return event.kind === 'MessageEvent' && event.llm_message.content.some(item => {
    if (item.type === 'text') return item.text.trim().length > 0;
    if (item.type === 'image') return item.image_urls.length > 0;
    return item.image_url.url.length > 0;
  });
}

export function presentEchoMindMessage(event: ChatEvent): ChatEvent {
  if (event.kind !== 'MessageEvent' || event.source !== 'agent') return event;
  return {
    ...event,
    llm_message: {
      ...event.llm_message,
      content: event.llm_message.content.map(item => item.type === 'text' ? {
        ...item,
        text: item.text
          .replace(/(?:EchoMind\s+)?(?:Main\s+Agent|Manager(?:\s+Agent)?|执行\s*Agent|主\s*Agent)\s*(?:的\s*)?队列/gi, '执行队列')
          .replace(/\b(?:EchoMind\s+Manager|Main\s+Agent|Manager\s+Agent)\b|(?:执行|主)\s*Agent/gi, '执行流程')
          .replace(/\bChat\s+Agent\b|对话\s*Agent/gi, 'EchoMind'),
      } : item),
    },
  };
}

export function visibleExecutionEvents(events: ChatEvent[]): ChatEvent[] {
  return events.filter(event => event.kind !== 'MessageEvent'
    || (event.llm_message.role === 'user' && hasVisibleMessage(event)))
    .map(event => event.kind === 'ActionEvent' && event.thought?.length
      ? { ...event, thought: [] }
      : event);
}

export interface EchoMindTurn {
  id: string;
  messages: ChatEvent[];
  execution: ChatEvent[];
  progress: TurnProgress[];
  needsConfirmation: boolean;
}

type ConversationEntry =
  | { kind: 'messages'; id: string; turn?: EchoMindTurn; messages: ChatEvent[] }
  | { kind: 'notice'; message: MessageEvent };

interface TurnProgress {
  id: string;
  title: string;
  stage?: string;
  status: string;
  reason?: string | null;
  needsAttention?: boolean;
  settled?: boolean;
  reportReady?: boolean;
  attempts?: { id: string; status: string; reason?: string | null }[];
}

type ExternalTask = NonNullable<ConversationSnapshot['external_tasks']>[number];
type TaskRun = NonNullable<ConversationSnapshot['task_runs']>[string];

function legacyQueuedRequirement(event: ChatEvent): string | undefined {
  if (event.kind !== 'ObservationEvent' || event.tool_name !== 'queue_echomind_requirement'
    || event.observation.operation_status !== 'completed') return undefined;
  const output = event.observation.to_llm_content?.find(block => block.type === 'text');
  if (!output) return undefined;
  try {
    const result = JSON.parse(output.text);
    if (result?.status === 'queued' && typeof result.task_id === 'string') return result.task_id;
  } catch {
    // Older tool results may have no structured task receipt.
  }
  return undefined;
}

export function groupEchoMindTurns(
  chatEvents: ChatEvent[],
  executionEvents: ChatEvent[],
  executionSnapshot: ConversationSnapshot | null,
) {
  const turns: EchoMindTurn[] = [];
  const entries: ConversationEntry[] = [];
  const leading: ChatEvent[] = [];
  const background: ChatEvent[] = [];
  const queuedTasks = new Set(executionSnapshot?.experiment_queue?.map(task => task.task_id));
  const taskOrigins = new Map(Object.entries(executionSnapshot?.task_origins ?? {}));
  const turnsById = new Map<string, EchoMindTurn>();
  for (const event of chatEvents) {
    if (!hasVisibleMessage(event) || event.llm_message.role !== 'user') continue;
    const id = event.turn_id ?? event.command_id ?? event.id;
    if (turnsById.has(id)) continue;
    const turn = { id, messages: [], execution: [], progress: [], needsConfirmation: false };
    turnsById.set(id, turn);
    turns.push(turn);
  }

  let current: EchoMindTurn | undefined;
  for (const event of chatEvents) {
    if (hasVisibleMessage(event) && event.llm_message.role === 'user') {
      current = turnsById.get(event.turn_id ?? event.command_id ?? event.id);
    }
    const owner = event.turn_id ? turnsById.get(event.turn_id) : current;
    if ((hasVisibleMessage(event) && event.llm_message.role !== 'system') || event.kind === 'ServerErrorEvent') {
      if (event.kind === 'MessageEvent' && event.execution_notice) {
        entries.push({ kind: 'notice', message: event });
        continue;
      }
      const message = presentEchoMindMessage(event);
      (owner?.messages ?? leading).push(message);
      const last = entries.at(-1);
      if (last?.kind === 'messages' && last.turn === owner) last.messages.push(message);
      else entries.push({ kind: 'messages', id: ('id' in event && event.id) || String(entries.length),
        turn: owner, messages: [message] });
      continue;
    }
    // Previously saved conversations recorded the binding only in the tool result.
    const taskId = !event.turn_id ? legacyQueuedRequirement(event) : undefined;
    if (owner && taskId && !taskOrigins.has(taskId)) taskOrigins.set(taskId, owner.id);
  }
  const lineage = executionLineage(executionSnapshot);
  const parentRunsByTask = new Map(executionSnapshot?.external_tasks?.map(task => [task.task_id, task.run_id]));
  const roots = new Map<string, string | undefined>();

  function rootForTask(taskId: string | undefined): string | undefined {
    if (!taskId) return undefined;
    if (roots.has(taskId)) return roots.get(taskId);
    const visited = new Set<string>();
    let currentTask: string | undefined = taskId;
    while (currentTask && !visited.has(currentTask) && !taskOrigins.has(currentTask)) {
      visited.add(currentTask);
      const parentRun = parentRunsByTask.get(currentTask);
      currentTask = parentRun ? lineage.taskForRun(parentRun) : undefined;
    }
    const root = currentTask && taskOrigins.has(currentTask) ? currentTask : undefined;
    for (const task of visited) roots.set(task, root);
    return root;
  }

  const progress = new Map<string, {
    turn: EchoMindTurn;
    runs: Map<string, ExperimentExecution[]>;
    external: ExternalTask[];
    latest?: TaskRun;
    hasActivity: boolean;
    reason?: string;
  }>();
  for (const [taskId, turnId] of taskOrigins) {
    const turn = turnsById.get(turnId);
    if (!turn) continue;
    progress.set(taskId, { turn, runs: new Map(), external: [], hasActivity: false });
  }

  for (const run of Object.values(executionSnapshot?.task_runs ?? {})) {
    const state = progress.get(rootForTask(run.task_id) ?? '');
    if (state && (!state.latest || run.seq > state.latest.seq)) state.latest = run;
  }
  for (const task of executionSnapshot?.external_tasks ?? []) {
    progress.get(rootForTask(task.task_id) ?? '')?.external.push(task);
  }
  for (const run of executionSnapshot?.experiment_executions ?? []) {
    const taskId = run.platform_task_id ?? lineage.taskByExperiment.get(run.run_id);
    const state = progress.get(rootForTask(taskId) ?? '');
    if (!state) continue;
    const attempts = state.runs.get(run.task_id) ?? [];
    attempts.push(run);
    state.runs.set(run.task_id, attempts);
  }

  const stages = new Map(executionSnapshot?.project?.plan.stages.map(stage => [stage.id, stage.name]));
  for (const event of executionEvents) {
    const run = lineage.experimentForEvent(event);
    const root = rootForTask(lineage.taskForEvent(event)) ?? rootForTask(run?.platform_task_id ?? undefined);
    const state = progress.get(root ?? '');
    if (state) {
      state.turn.execution.push(event);
      state.hasActivity = true;
      if (event.kind === 'ServerErrorEvent' && event.severity === 'error') state.reason = event.detail;
    } else if (!executionSnapshot?.project || !run?.stage_id || (!stages.has(run.stage_id) && !run.stage_snapshot)) {
      background.push(event);
    }
  }

  for (const request of executionSnapshot?.pending_inputs ?? []) {
    const run = request.task_run_id ? lineage.experiments.get(request.task_run_id) : undefined;
    const taskId = request.run_id ? lineage.taskForRun(request.run_id) : undefined;
    const state = progress.get(rootForTask(taskId ?? run?.platform_task_id ?? undefined) ?? '');
    if (state) state.turn.needsConfirmation = true;
  }
  for (const permission of executionSnapshot?.pending_permissions ?? []) {
    for (const itemId of permission.operation_ids) {
      const item = lineage.items.get(itemId);
      const taskId = item?.task_id ?? (item && 'run_id' in item && item.run_id ? lineage.taskForRun(item.run_id) : undefined);
      const state = progress.get(rootForTask(taskId) ?? '');
      if (state) state.turn.needsConfirmation = true;
    }
  }

  for (const [taskId, state] of progress) {
    const { turn } = state;
    if (state.runs.size) {
      for (const attempts of state.runs.values()) {
        const run = attempts[attempts.length - 1];
        const stage = (run.stage_id && stages.get(run.stage_id)) || run.stage_snapshot?.name;
        turn.progress.push({
          id: `${taskId}/${run.task_id}`, title: run.task_name, stage,
          status: executionProgressLabel(run), reason: run.waiting_reason,
          needsAttention: ['failed', 'needs_input', 'waiting_authorization'].includes(run.state) || run.report_state === 'failed',
          settled: ['reported', 'failed', 'cancelled', 'rejected', 'abandoned'].includes(run.state)
            || (run.state === 'succeeded' && ['not_started', 'ready', 'failed'].includes(run.report_state)),
          reportReady: run.state === 'reported' || (run.state === 'succeeded' && run.report_state === 'ready'),
          attempts: attempts.length > 1 ? attempts.map(attempt => ({ id: attempt.run_id,
            status: executionProgressLabel(attempt), reason: attempt.waiting_reason })) : undefined,
        });
      }
    } else {
      turn.progress.push({ id: taskId, title: '执行进度', ...requirementProgress(queuedTasks.has(taskId), state) });
    }
  }
  return { leading, turns, background, entries };
}

function requirementProgress(queued: boolean, { latest, external, hasActivity, reason }: {
  latest?: TaskRun; external: ExternalTask[]; hasActivity: boolean; reason?: string;
}): Omit<TurnProgress, 'id' | 'title'> {
  if (queued) return { status: '排队中' };
  if (latest?.status === 'error' || latest?.status === 'stuck') {
    return { status: '执行失败', reason, needsAttention: true, settled: true };
  }
  if (latest?.status === 'paused') return { status: '已暂停' };
  if (external.some(task => ['pending', 'running', 'waiting'].includes(task.status))) {
    return { status: '等待平台结果' };
  }
  const task = external.at(-1);
  if (task?.status === 'failed') return { status: '执行失败', reason: task.error_summary, needsAttention: true };
  if (task?.status === 'terminated' || task?.status === 'stopped') return { status: '已取消', settled: true };
  if (latest?.status === 'running') return { status: '执行中' };
  if (task?.status === 'succeeded' && task.resume_auto_run !== false && latest?.task_id !== task.task_id) {
    return { status: '结果已返回 · 等待分析与交付' };
  }
  if (latest?.status === 'idle' || latest?.status === 'finished' || task?.status === 'succeeded') {
    return { status: '本轮执行已结束', settled: true };
  }
  return { status: hasActivity ? '已开始执行' : '准备执行' };
}

export function executionLineage(snapshot: ConversationSnapshot | null) {
  const items = new Map(snapshot?.timeline.map(item => [item.item_id, item]));
  const tasksByRun = new Map(Object.entries(snapshot?.task_runs ?? {}).map(([runId, run]) => [runId, run.task_id]));
  for (const item of items.values()) {
    if ('run_id' in item && item.run_id && item.task_id && !tasksByRun.has(item.run_id)) {
      tasksByRun.set(item.run_id, item.task_id);
    }
  }
  const taskForRun = (runId: string) => tasksByRun.get(runId) ?? legacyCallbackTaskId(runId);
  const itemForEvent = (event: ChatEvent) => {
    const id = event.kind === 'ObservationEvent' ? event.action_id ?? event.id : 'id' in event ? event.id : undefined;
    return id ? items.get(id) : undefined;
  };
  const taskForEvent = (event: ChatEvent) => {
    const item = itemForEvent(event);
    const runId = (event.kind === 'MessageEvent' ? event.run_id : undefined)
      ?? (item && 'run_id' in item ? item.run_id : undefined);
    return event.task_id ?? (runId ? taskForRun(runId) : undefined);
  };

  const experiments = new Map(snapshot?.experiment_executions?.map(run => [run.run_id, run]));
  const byPlatformTask = new Map<string, ExperimentExecution>();
  const byParentRun = new Map<string, ExperimentExecution | null>();
  const parentRuns = new Map(snapshot?.external_tasks?.map(task => [task.task_id, task.run_id]));
  const taskByExperiment = new Map<string, string>();
  for (const run of experiments.values()) {
    if (!run.platform_task_id) continue;
    byPlatformTask.set(run.platform_task_id, run);
    const parent = parentRuns.get(run.platform_task_id);
    if (parent) byParentRun.set(parent, byParentRun.has(parent) ? null : run);
  }
  for (const item of items.values()) {
    if (item.kind === 'operation' && item.execution && item.task_id && !taskByExperiment.has(item.execution.task_run_id)) {
      taskByExperiment.set(item.execution.task_run_id, item.task_id);
    }
  }
  const experimentForEvent = (event: ChatEvent) => {
    const item = itemForEvent(event);
    if (item?.kind === 'operation' && item.execution) return experiments.get(item.execution.task_run_id);
    const taskId = taskForEvent(event);
    const runId = item && 'run_id' in item ? item.run_id : undefined;
    return (taskId ? byPlatformTask.get(taskId) : undefined)
      ?? (runId ? experiments.get(runId) ?? byParentRun.get(runId) ?? undefined : undefined);
  };
  return { items, taskForRun, taskForEvent, experiments, taskByExperiment, experimentForEvent };
}

// Compatibility for snapshots written before task IDs were attached to execution items.
function legacyCallbackTaskId(runId: string): string {
  return /^callback:(.+):(?:succeeded|failed|terminated|stopped)(?::[^:]+)?$/.exec(runId)?.[1] ?? runId;
}
