import type { ChatEvent, ConversationSnapshot, MessageEvent } from './types';

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

interface EchoMindTurn {
  id: string;
  messages: ChatEvent[];
  execution: ChatEvent[];
  queued: boolean;
}

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
  const leading: ChatEvent[] = [];
  const background: ChatEvent[] = [];
  const turnsByTask = new Map<string, EchoMindTurn>();
  const queuedTasks = new Set(executionSnapshot?.experiment_queue?.map(task => task.task_id));
  const taskOrigins = new Map(Object.entries(executionSnapshot?.task_origins ?? {}));
  const turnsById = new Map<string, EchoMindTurn>();
  for (const event of chatEvents) {
    if (!hasVisibleMessage(event) || event.llm_message.role !== 'user') continue;
    const id = event.turn_id ?? event.command_id ?? event.id;
    if (turnsById.has(id)) continue;
    const turn = { id, messages: [], execution: [], queued: false };
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
      (owner?.messages ?? leading).push(presentEchoMindMessage(event));
      continue;
    }
    // Previously saved conversations recorded the binding only in the tool result.
    const taskId = !event.turn_id ? legacyQueuedRequirement(event) : undefined;
    if (owner && taskId && !taskOrigins.has(taskId)) taskOrigins.set(taskId, owner.id);
  }
  for (const [taskId, turnId] of taskOrigins) {
    const turn = turnsById.get(turnId);
    if (!turn) continue;
    turnsByTask.set(taskId, turn);
    turn.queued ||= queuedTasks.has(taskId);
  }

  const runsByItem = new Map<string, string>();
  const tasksByRun = new Map<string, string>();
  for (const item of executionSnapshot?.timeline ?? []) {
    if (!('run_id' in item) || !item.run_id) continue;
    runsByItem.set(item.item_id, item.run_id);
    if (item.task_id) tasksByRun.set(item.run_id, item.task_id);
  }
  const parentRunsByTask = new Map(executionSnapshot?.external_tasks?.map(task => [task.task_id, task.run_id]));
  const turnsByTaskChain = new Map<string, EchoMindTurn | undefined>();

  function taskForRun(runId: string): string {
    return tasksByRun.get(runId) ?? legacyCallbackTaskId(runId);
  }

  function turnForTask(taskId: string): EchoMindTurn | undefined {
    if (turnsByTaskChain.has(taskId)) return turnsByTaskChain.get(taskId);
    const visited = new Set<string>();
    let currentTask: string | undefined = taskId;
    let owner: EchoMindTurn | undefined;
    while (currentTask && !visited.has(currentTask)) {
      visited.add(currentTask);
      owner = turnsByTask.get(currentTask);
      if (owner) break;
      const parentRun: string | null | undefined = parentRunsByTask.get(currentTask);
      currentTask = parentRun ? taskForRun(parentRun) : undefined;
    }
    turnsByTaskChain.set(taskId, owner);
    return owner;
  }

  for (const event of executionEvents) {
    const itemId = event.kind === 'ObservationEvent' ? event.action_id ?? event.id
      : 'id' in event ? event.id : undefined;
    const runId = (event.kind === 'MessageEvent' ? event.run_id : undefined)
      ?? (itemId ? runsByItem.get(itemId) : undefined);
    const taskId = event.task_id ?? (runId ? taskForRun(runId) : undefined);
    const owner = taskId ? turnForTask(taskId) : undefined;
    (owner?.execution ?? background).push(event);
  }

  return { leading, turns, background };
}

// Compatibility for snapshots written before task IDs were attached to execution items.
function legacyCallbackTaskId(runId: string): string {
  return /^callback:(.+):(?:succeeded|failed|terminated|stopped)(?::[^:]+)?$/.exec(runId)?.[1] ?? runId;
}
