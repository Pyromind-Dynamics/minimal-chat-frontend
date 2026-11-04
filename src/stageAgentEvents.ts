import type { ConversationSnapshot, TimelineMessage, TimelineOperation } from './types';
import { snapshotToChatEvents } from './productSnapshot.ts';
import { readableResult, subagentDisplay } from './subagentPresentation.ts';

export function stageAgentEvents(operations: readonly TimelineOperation[]) {
  const items = new Map<string, TimelineMessage | TimelineOperation>();
  let truncated = false;
  for (const operation of [...operations].sort((a, b) => a.started_seq - b.started_seq)) {
    if (operation.activity) {
      truncated ||= operation.activity.truncated;
      for (const item of operation.activity.items) items.set(item.item_id, item);
    } else {
      const trace = subagentDisplay(operation.details)?.trace;
      const text = trace?.text || readableResult(operation.output.filter(block => block.type === 'text').map(block => block.text).join('\n'));
      truncated ||= !!trace?.truncated;
      // Historical text remains a message; never guess tool calls from log lines.
      if (text.trim()) items.set(operation.item_id, {
        kind: 'message', item_id: `${operation.item_id}:legacy`, started_seq: operation.started_seq,
        status: 'completed', role: 'assistant', content: [{type: 'text', text: text.slice(-32768)}],
      });
    }
  }
  const timeline = [...items.values()];
  if (timeline.length > 128) truncated = true;
  return {events: snapshotToChatEvents({timeline: timeline.slice(-128)} as ConversationSnapshot), truncated};
}
