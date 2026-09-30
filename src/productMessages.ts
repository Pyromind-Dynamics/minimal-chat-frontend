import type { ConversationSnapshot, ProductContent, ProductEvent, TimelineMessage } from './types';

export function pendingMessageEvents(
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
export function projectMessageEvents(
  snapshot: ConversationSnapshot,
  events: ProductEvent[],
): ConversationSnapshot {
  const timeline = [...snapshot.timeline];
  for (const event of pendingMessageEvents(snapshot, events)) {
    const id = event.payload.message_id;
    if (typeof id !== 'string' || !event.type.startsWith('message.')) continue;
    const index = timeline.findIndex((item) => item.kind === 'message' && item.item_id === id);
    const existing = index < 0 ? undefined : timeline[index];
    const role = event.payload.role;
    let message: TimelineMessage = existing?.kind === 'message' ? existing : {
      kind: 'message', item_id: id, started_seq: event.seq,
      role: role === 'user' || role === 'system' ? role : 'assistant',
      run_id: event.run_id, content: [], status: 'streaming',
    };
    if (event.type === 'message.started' && !existing) {
      message = { ...message, content: content(event.payload.content) };
    } else if (event.type === 'message.delta' && message.status === 'streaming') {
      const text = typeof event.payload.text === 'string' ? event.payload.text : '';
      const blocks = [...message.content];
      const last = blocks.at(-1);
      if (last?.type === 'text') blocks[blocks.length - 1] = { ...last, text: last.text + text };
      else blocks.push({ type: 'text', text });
      message = { ...message, content: blocks };
    } else if (event.type === 'message.completed') {
      message = {
        ...message, status: 'completed', completed_seq: event.seq,
        content: 'content' in event.payload ? content(event.payload.content) : message.content,
      };
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
