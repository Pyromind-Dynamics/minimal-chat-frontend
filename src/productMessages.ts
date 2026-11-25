import type { ConversationSnapshot, ExecutionNoticeLink, ProductContent, ProductEvent, TimelineItem, TimelineMessage, TimelineOperation } from './types';

export function pendingTimelineEvents(
  snapshot: ConversationSnapshot,
  events: ProductEvent[],
): ProductEvent[] {
  return [...new Map(events.filter((event) =>
    event.conversation_id === snapshot.conversation_id
    && event.seq > snapshot.through_seq,
  ).map((event) => [event.seq, event])).values()].sort((a, b) => a.seq - b.seq);
}

// Only replay events newer than the snapshot. A snapshot can arrive before
// its corresponding SSE frames, or while newer deltas are already rendered.
export function projectTimelineEvents(
  snapshot: ConversationSnapshot,
  events: ProductEvent[],
): ConversationSnapshot {
  const timeline = [...snapshot.timeline];
  for (const event of pendingTimelineEvents(snapshot, events)) {
    if (event.type.startsWith('operation.')) {
      applyOperationEvent(timeline, event);
      continue;
    }
    const id = event.payload.message_id;
    if (typeof id !== 'string' || !event.type.startsWith('message.')) continue;
    const index = timeline.findIndex((item) => item.kind === 'message' && item.item_id === id);
    const existing = index < 0 ? undefined : timeline[index];
    const role = event.payload.role;
    let message: TimelineMessage & Pick<TimelineItem, 'turn_id' | 'task_id'> = existing?.kind === 'message' ? existing : {
      kind: 'message', item_id: id, started_seq: event.seq, started_at: event.occurred_at,
      role: role === 'user' || role === 'system' ? role : 'assistant',
      run_id: event.run_id, turn_id: event.turn_id, task_id: event.task_id,
      content: [], status: 'streaming',
    };
    if (event.type === 'message.started' && !existing) {
      message = { ...message, content: content(event.payload.content) };
    } else if (event.type === 'message.delta' && message.status === 'streaming') {
      const text = typeof event.payload.text === 'string' ? event.payload.text : '';
      const blocks = [...message.content];
      const last = blocks.at(-1);
      if (last?.type === 'text') blocks[blocks.length - 1] = { ...last, text: last.text + text };
      else blocks.push({ type: 'text', text });
      const projectDelta = event.payload.project_reply_delta;
      message = { ...message, content: blocks,
        project_reply: typeof projectDelta === 'string' ? (message.project_reply ?? '') + projectDelta : message.project_reply };
    } else if (event.type === 'message.completed') {
      const projectReply = event.payload.project_reply;
      message = {
        ...message, status: 'completed', completed_seq: event.seq,
        content: 'content' in event.payload ? content(event.payload.content) : message.content,
        project_reply: typeof projectReply === 'string' || projectReply === null ? projectReply : message.project_reply,
      };
    }
    const notice = event.payload.execution_notice;
    if (notice && typeof notice === 'object' && !Array.isArray(notice)) {
      message = { ...message, execution_notice: notice as ExecutionNoticeLink };
    }
    if (typeof event.payload.command_id === 'string') {
      message = { ...message, command_id: event.payload.command_id };
    }
    if (index < 0) timeline.push(message);
    else timeline[index] = message;
  }
  timeline.sort((a, b) => a.started_seq - b.started_seq);
  return { ...snapshot, timeline };
}

function applyOperationEvent(timeline: TimelineItem[], event: ProductEvent) {
  const { operation_id: id, name, category, error_code, arguments: args, output, details } = event.payload;
  if (typeof id !== 'string') return;
  const index = timeline.findIndex(item => item.kind === 'operation' && item.item_id === id);
  const existing = timeline[index];
  const starting = event.type === 'operation.started';
  if (!starting && !['operation.progress', 'operation.completed', 'operation.failed'].includes(event.type)) return;
  if (category === 'subagent' || (existing?.kind === 'operation'
    && (starting || existing.category === 'subagent' || existing.status !== 'running'))) return;
  const operation: TimelineOperation & Pick<TimelineItem, 'turn_id' | 'task_id'> =
    existing?.kind === 'operation' ? { ...existing } : {
      kind: 'operation', item_id: id, started_seq: event.seq, name: typeof name === 'string' ? name : 'operation',
      category: starting && category !== 'observation' ? 'tool' : 'observation', status: 'running',
      arguments: starting ? args ?? {} : {}, output: [], thought: [], details: null,
      run_id: event.run_id, task_id: event.task_id, turn_id: event.turn_id,
    };
  if (!starting) {
    if ('output' in event.payload) operation.output = content(output);
    else if ('content' in event.payload) operation.output = content(event.payload.content);
    if ('details' in event.payload) operation.details = details;
    if ('error_code' in event.payload) operation.error_code = typeof error_code === 'string' ? error_code : null;
    if (event.type !== 'operation.progress') {
      operation.status = event.type === 'operation.failed' ? 'failed' : 'completed';
      operation.completed_seq = event.seq;
    }
  }
  if (index < 0) timeline.push(operation);
  else timeline[index] = operation;
}

function content(value: unknown): ProductContent[] {
  return Array.isArray(value) ? value as ProductContent[] : [];
}


export function receivedUserCommandIds(snapshot: ConversationSnapshot): Set<string> {
  return new Set(snapshot.timeline.flatMap((item) => {
    if (item.kind !== 'message' || item.role !== 'user') return [];
    const id = item.command_id ?? item.run_id;
    return typeof id === 'string' ? [id] : [];
  }));
}
