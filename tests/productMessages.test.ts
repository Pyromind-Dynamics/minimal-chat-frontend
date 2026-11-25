import assert from 'node:assert/strict';
import test from 'node:test';
import { pendingMessageEvents, projectMessageEvents, receivedUserCommandIds } from '../src/productMessages.ts';
import { mainAgentMessages } from '../src/echomindConversationPresentation.ts';
import { snapshotToChatEvents } from '../src/productSnapshot.ts';
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


test('callback steering acknowledges commands across SSE replay and refreshed snapshots', () => {
  const updates = ['command-1', 'command-2'].map((commandId, index) => ({
    ...event(index + 2, 'message.completed', `u${index}`, 'same message'),
    run_id: 'callback:graph', payload: { message_id: `u${index}`, role: 'user',
      command_id: commandId, content: [{ type: 'text', text: 'same message' }] },
  }));
  const projected = projectMessageEvents(snapshot, [...updates, ...updates]);
  assert.deepEqual([...receivedUserCommandIds(projected)], ['run', 'command-1', 'command-2']);
  assert.equal(projected.timeline.filter((item) => item.kind === 'message' && item.role === 'user').length, 3);
  const refreshed = { ...projected, through_seq: 3 };
  assert.deepEqual(projectMessageEvents(refreshed, updates), refreshed);
  assert.equal(receivedUserCommandIds(refreshed).has('callback:graph'), false);
});

test('streamed messages keep the first event time through completion and snapshot refresh', () => {
  const start = { ...event(2, 'message.started', 'reply'), occurred_at: '2026-11-23T10:05:14Z' };
  const finish = { ...event(3, 'message.completed', 'reply', 'done'), occurred_at: '2026-11-23T10:05:28Z' };
  const streamed = projectMessageEvents(snapshot, [start, finish]);
  const reply = streamed.timeline[1];
  assert.equal(reply.kind, 'message');
  assert.equal(reply.started_at, start.occurred_at);
  assert.deepEqual(projectMessageEvents({ ...streamed, through_seq: 3 }, [start, finish]).timeline, streamed.timeline);
});

test('a public preview stays attached to its original turn through reload and completion', () => {
  const first = event(2, 'message.delta', 'public', 'stage');
  const origin = { origin_turn_id: 'older-turn', source_message_id: 'manager-item', public_copy: true };
  first.payload.execution_notice = { ...origin, source_seq: 41 };
  const partial = projectMessageEvents(snapshot, [first]);
  const row = partial.timeline[1];
  assert.ok(row.kind === 'message');
  assert.equal(row.execution_notice?.origin_turn_id, 'older-turn');
  assert.equal(row.status, 'streaming');
  const done = event(3, 'message.completed', 'public', 'stage result');
  done.payload.execution_notice = { ...origin, has_result: true };
  const result = projectMessageEvents({ ...partial, through_seq: 2 }, [first, done, done]);
  assert.deepEqual(texts(result), ['hello', 'stage result']);
  assert.ok(result.timeline[1].kind === 'message' && result.timeline[1].execution_notice?.has_result);
});

test('Main Agent public reply is visible before completion and resumes without duplicating text', () => {
  const first = event(2, 'message.delta', 'main-result', '评估');
  const next = event(3, 'message.delta', 'main-result', '完成');
  first.payload.project_reply_delta = '评估';
  next.payload.project_reply_delta = '完成';
  const readMain = (value: ConversationSnapshot) => mainAgentMessages(snapshotToChatEvents(value))
    .flatMap(message => message.llm_message.content).map(block => block.type === 'text' && block.text);
  const partial = { ...projectMessageEvents(snapshot, [first]), through_seq: 2 };
  assert.deepEqual(readMain(partial), ['评估']);
  const resumed = projectMessageEvents(partial, [first, next]);
  assert.deepEqual(readMain(resumed), ['评估完成']);
  const withdrawn = event(4, 'message.completed', 'main-result');
  withdrawn.payload.project_reply = null;
  assert.deepEqual(readMain(projectMessageEvents(partial, [next, withdrawn])), []);
});
