import assert from 'node:assert/strict';
import test from 'node:test';
import { pendingMessageEvents, projectMessageEvents } from '../src/productMessages.ts';
import type { ConversationSnapshot, ProductEvent } from '../src/types.ts';

const snapshot: ConversationSnapshot = {
  schema_version: 1, conversation_id: 'c1', through_seq: 1, status: 'running',
  capabilities: { resume: true, cancel: true, permission_reply: true, partial_message: true, fork: true, workflow_rollback: true, native_workspace_tools: [] },
  timeline: [{ kind: 'message', item_id: 'user', started_seq: 1, completed_seq: 1,
    role: 'user', run_id: 'run', content: [{ type: 'text', text: 'hello' }], status: 'completed' }],
  pending_permissions: [], usage: { input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
};
function event(seq: number, type: string, messageId: string, text = ''): ProductEvent {
  return { schema_version: 1, event_id: `e${seq}`, conversation_id: 'c1', seq, type,
    occurred_at: '', run_id: 'run', payload: { message_id: messageId, role: 'assistant',
      ...(type === 'message.delta' ? { text } : { content: [{ type: 'text', text }] }) } };
}
function texts(value: ConversationSnapshot) {
  return value.timeline.filter((item) => item.kind === 'message').map((item) =>
    item.content.map((block) => block.type === 'text' ? block.text : '').join(''));
}

test('user and multiple assistant messages in one run retain separate identities', () => {
  const result = projectMessageEvents(snapshot, [
    event(2, 'message.started', 'a1'), event(3, 'message.delta', 'a1', 'before tool'),
    event(4, 'message.completed', 'a1', 'before tool'), event(6, 'message.started', 'a2'),
    event(7, 'message.delta', 'a2', 'final'),
  ]);
  assert.deepEqual(texts(result), ['hello', 'before tool', 'final']);
});

test('snapshot rebases deltas at its cursor and retains newer text and completion', () => {
  const events = [event(2, 'message.started', 'a'), event(3, 'message.delta', 'a', 'one'),
    event(4, 'message.delta', 'a', ' two'), event(5, 'message.completed', 'a', 'one two!')];
  const partial = { ...projectMessageEvents(snapshot, events.slice(0, 2)), through_seq: 3 };
  assert.deepEqual(texts(projectMessageEvents(partial, events.slice(0, 3))), ['hello', 'one two']);
  assert.deepEqual(texts(projectMessageEvents(partial, events)), ['hello', 'one two!']);
  assert.deepEqual(pendingMessageEvents(partial, events).map((item) => item.seq), [4, 5]);
  const complete = { ...projectMessageEvents(partial, events), through_seq: 5 };
  assert.deepEqual(texts(projectMessageEvents(complete, events)), ['hello', 'one two!']);
});

test('reconnection restores an unfinished snapshot without receiving message.started again', () => {
  const partial = { ...projectMessageEvents(snapshot, [event(2, 'message.started', 'a'),
    event(3, 'message.delta', 'a', 'one')]), through_seq: 3 };
  const delta = event(4, 'message.delta', 'a', ' two');
  assert.deepEqual(texts(projectMessageEvents(partial, [delta, delta])), ['hello', 'one two']);
  assert.deepEqual(texts(projectMessageEvents(partial, [{ ...delta, conversation_id: 'other' }])), ['hello', 'one']);
});

test('completion works without an overlay or REST refresh and keeps operation order', () => {
  const withTool: ConversationSnapshot = { ...snapshot, through_seq: 5, timeline: [
    ...snapshot.timeline,
    { kind: 'operation', item_id: 'tool', started_seq: 5, name: 'read', category: 'tool',
      status: 'running', arguments: {}, output: [], thought: [], details: null },
  ] };
  const result = projectMessageEvents(withTool, [event(6, 'message.completed', 'final', 'done')]);
  assert.deepEqual(texts(result), ['hello', 'done']);
  assert.deepEqual(result.timeline.map((item) => item.item_id), ['user', 'tool', 'final']);
});
