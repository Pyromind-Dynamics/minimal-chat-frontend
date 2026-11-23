import assert from 'node:assert/strict';
import test from 'node:test';
import { groupEchoMindTurns } from '../src/echomindConversationPresentation.ts';
import { snapshotToChatEvents } from '../src/productSnapshot.ts';
import type { ConversationSnapshot, TimelineItem, TimelineMessage, TimelineOperation } from '../src/types.ts';

function snapshot(items: TimelineItem[], extra: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    schema_version: 1, conversation_id: 'session', through_seq: 50, status: 'running',
    capabilities: { resume: true, cancel: true, permission_reply: true, partial_message: true,
      fork: true, workflow_rollback: true, native_workspace_tools: [] },
    timeline: items, pending_permissions: [],
    usage: { input_tokens: 0, output_tokens: 0, cached_tokens: 0 }, ...extra,
  };
}

function message(item_id: string, started_seq: number, role: TimelineMessage['role'], run_id: string): TimelineMessage {
  return { kind: 'message', item_id, started_seq, role, run_id, status: 'completed',
    content: [{ type: 'text', text: item_id }] };
}

function operation(item_id: string, started_seq: number, run_id: string,
  fields: Partial<TimelineOperation> = {}): TimelineOperation {
  return { kind: 'operation', item_id, started_seq, run_id, name: 'terminal', category: 'tool',
    status: 'running', arguments: {}, output: [], thought: [], details: null, ...fields };
}

function receipt(taskId: string, seq: number): TimelineOperation {
  return operation(taskId, seq, 'shared-chat-run', {
    name: 'queue_echomind_requirement', status: 'completed',
    output: [{ type: 'text', text: JSON.stringify({ task_id: taskId, status: 'queued' }) }],
  });
}

function group(chat: ConversationSnapshot, execution: ConversationSnapshot) {
  return groupEchoMindTurns(snapshotToChatEvents(chat), snapshotToChatEvents(execution), execution);
}

test('interleaved execution and delayed callbacks remain under the originating turn', () => {
  const first = 'requirement:chat:first';
  const second = 'requirement:chat:second';
  const firstRun = `callback:${first}:succeeded:run-a`;
  const secondRun = `callback:${second}:succeeded:run-b`;
  const chat = snapshot([
    message('user-1', 1, 'user', 'shared-chat-run'),
    receipt(first, 2),
    message('reply-1', 3, 'assistant', 'shared-chat-run'),
    message('user-2', 4, 'user', 'shared-chat-run'),
    receipt(second, 5),
    message('reply-2', 6, 'assistant', 'shared-chat-run'),
    message('status-question', 7, 'user', 'status-run'),
    message('status-reply', 8, 'assistant', 'status-run'),
  ]);
  const execution = snapshot([
    message('started-first', 1, 'assistant', firstRun),
    operation('step-second', 2, secondRun),
    operation('step-first', 3, firstRun, { status: 'failed' }),
    message('late-result-first', 4, 'assistant', 'callback:platform-task:succeeded:result-run'),
    operation('unrelated', 5, 'standalone-run'),
  ], {
    external_tasks: [{ task_id: 'platform-task', status: 'succeeded', run_id: firstRun }],
  });
  const { turns, background } = group(chat, execution);
  const eventIds = (events: typeof background) => events.map(event => 'id' in event ? event.id : event.code);
  assert.deepEqual(turns.map(turn => eventIds(turn.messages)),
    [['user-1', 'reply-1'], ['user-2', 'reply-2'], ['status-question', 'status-reply']]);
  assert.deepEqual(turns.map(turn => eventIds(turn.execution)), [
    ['started-first', 'step-first', 'step-first:observation', 'late-result-first'],
    ['step-second', 'step-second:observation'],
    [],
  ]);
  assert.deepEqual(eventIds(background), ['unrelated', 'unrelated:observation']);
});

test('a queued requirement has a status before it has any execution events', () => {
  const taskId = 'requirement:chat:queued';
  const chat = snapshot([message('user', 1, 'user', 'shared-chat-run'), receipt(taskId, 2)]);
  const execution = snapshot([], { experiment_queue: [{ task_id: taskId, kind: 'requirement' }] });
  const { turns } = group(chat, execution);
  assert.equal(turns[0].queued, true);
  assert.deepEqual(turns[0].execution, []);
});

test('server turn ownership joins delayed events without a readable run ID or tool receipt', () => {
  const chat = snapshot([
    { ...message('first-input', 1, 'user', 'shared'), turn_id: 'first' },
    { ...message('second-input', 2, 'user', 'shared'), turn_id: 'second' },
    { ...message('late-first-reply', 3, 'assistant', 'shared'), turn_id: 'first' },
  ]);
  const execution = snapshot([
    { ...operation('late-first-step', 1, 'opaque-parent-run'), task_id: 'source-task' },
    { ...operation('late-platform-step', 2, 'opaque-follow-up'), task_id: 'platform-task' },
    { kind: 'notice', item_id: 'finish-error', started_seq: 3, severity: 'error',
      code: 'runner_exited', message: 'The first run stopped', task_id: 'source-task' },
  ], {
    task_origins: { 'source-task': 'first', 'queued-task': 'second' },
    experiment_queue: [{ task_id: 'queued-task', kind: 'requirement' }],
    external_tasks: [{ task_id: 'platform-task', status: 'succeeded', run_id: 'opaque-parent-run' }],
  });
  const { turns, background } = group(chat, execution);
  assert.deepEqual(turns[0].messages.map(event => 'id' in event ? event.id : ''), ['first-input', 'late-first-reply']);
  assert.equal(turns[0].execution.length, 5);
  assert.equal(turns[1].queued, true);
  assert.deepEqual(turns[1].execution, []);
  assert.deepEqual(background, []);
});
