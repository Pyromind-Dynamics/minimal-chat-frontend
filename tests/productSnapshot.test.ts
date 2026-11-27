import assert from 'node:assert/strict';
import test from 'node:test';

import { pausedProjectAction, snapshotToChatEvents } from '../src/productSnapshot.ts';
import { getUserInputInterruption } from '../src/toolErrorPresentation.ts';
import type { ConversationSnapshot, ObservationEvent } from '../src/types.ts';

test('failed operations copy their top-level error code into the observation', () => {
  const snapshot: ConversationSnapshot = {
    schema_version: 1,
    conversation_id: 'conversation-1',
    through_seq: 2,
    status: 'idle',
    capabilities: {
      resume: true,
      cancel: true,
      permission_reply: true,
      partial_message: true,
      fork: true,
      workflow_rollback: true,
      native_workspace_tools: [],
    },
    timeline: [{
      kind: 'operation',
      item_id: 'call-1',
      started_seq: 1,
      completed_seq: 2,
      name: 'preview_dataset',
      category: 'tool',
      status: 'failed',
      thought: [],
      arguments: {},
      output: [{ type: 'text', text: 'Too many samples.' }],
      details: { retryable: true },
      error_code: 'sample_selection_limit',
    }],
    pending_permissions: [],
    usage: { input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
  };

  const observation = snapshotToChatEvents(snapshot)[1] as ObservationEvent;
  assert.equal(observation.observation.is_error, true);
  assert.equal(observation.observation.error_code, 'sample_selection_limit');
  assert.equal(observation.observation.retryable, true);
});

test('workflow cards use the product event id required by fork and rollback', () => {
  const snapshot = {
    timeline: [{ kind: 'workflow', item_id: 'run-finished:workflow', started_seq: 7,
      workflow: { resource_id: 'pyromind_workflow', version: 'workflow-v3', dsl: 'workflow = Final()' } }],
  } as ConversationSnapshot;
  const event = snapshotToChatEvents(snapshot)[0];
  assert.equal(event.kind, 'ConversationStateUpdateEvent');
  assert.equal('id' in event && event.id, 'run-finished:workflow');
});


test('running operations retain progress in place across refreshed snapshots', () => {
  const snapshot = { timeline: [{ kind: 'operation', item_id: 'history:1', started_seq: 1,
    name: '历史经验', category: 'tool', status: 'running', thought: [], arguments: {},
    output: [{ type: 'text', text: '' }], details: { node: 'clean', command: 'python3 clean.py', verdict: null },
  }] } as ConversationSnapshot;
  const first = snapshotToChatEvents(snapshot)[1] as ObservationEvent;
  assert.equal(first.observation.operation_status, 'running');
  assert.equal(first.observation.node, 'clean');
  snapshot.timeline[0] = { ...snapshot.timeline[0], details: { node: 'report', command: null, verdict: null } } as typeof snapshot.timeline[0];
  const next = snapshotToChatEvents(snapshot)[1] as ObservationEvent;
  assert.equal(next.id, first.id);
  assert.equal(next.observation.node, 'report');
  assert.equal(next.observation.command, null);
});

test('resolved input is displayed even when the runner never reported tool completion', () => {
  for (const status of ['cancelled', 'interrupted']) {
    const snapshot = { timeline: [{
      kind: 'operation', item_id: 'ask-1', name: 'ask_user', status: 'running',
      thought: [], arguments: {}, output: [], details: { user_input: { status } },
    }] } as ConversationSnapshot;
    const events = snapshotToChatEvents(snapshot);
    assert.equal(events.length, 2);
    const observation = events[1] as ObservationEvent;
    assert.equal(getUserInputInterruption('ask_user', observation.observation)?.label,
      status === 'cancelled' ? '已取消' : '已中断');
  }
});

test('only a paused, unanswered interruption of the latest question offers to ask again', () => {
  const question = {kind: 'operation', name: 'ask_user', status: 'failed',
    details: {user_input: {status: 'interrupted'}}} as const;
  const snapshot = {status: 'paused', pending_permissions: [], timeline: [question]} as ConversationSnapshot;
  assert.equal(pausedProjectAction(snapshot), 'reask');
  assert.equal(pausedProjectAction({...snapshot, status: 'running'}), undefined);
  assert.equal(pausedProjectAction({...snapshot, pending_inputs: [{request_id: 'new', questions: []}]}), undefined);
  assert.equal(pausedProjectAction({...snapshot, timeline: [...snapshot.timeline,
    {kind: 'message', role: 'user', item_id: 'new-message', started_seq: 10, content: [], status: 'completed'}]}), undefined);
  const queued = { ...snapshot, automatic_turns_suspended: true, experiment_queue: [{task_id: 'retry', kind: 'requirement'}] };
  assert.equal(pausedProjectAction(queued), 'resumeQueue');
  assert.equal(pausedProjectAction({...queued, timeline: []}), 'resumeQueue');
  assert.equal(pausedProjectAction({...queued, pending_inputs: [{request_id: 'live', questions: []}]}), undefined);
  const cancelled = { ...question, details: { user_input: { status: 'cancelled' } } };
  assert.equal(pausedProjectAction({ ...snapshot, timeline: [cancelled] } as ConversationSnapshot), undefined);
});

test('archived sessions use the archive banner instead of a server error card', () => {
  const snapshot: ConversationSnapshot = {
    schema_version: 1, conversation_id: 'legacy', through_seq: 1, status: 'closed',
    capabilities: {read_only: true, resume: false, cancel: false, permission_reply: false,
      partial_message: false, fork: false, workflow_rollback: false, native_workspace_tools: []},
    timeline: [{kind: 'notice', item_id: 'archive', started_seq: 1, severity: 'warning',
      code: 'legacy_harness_retired', message: '此会话已归档。'}],
    pending_permissions: [], usage: {input_tokens: 0, output_tokens: 0, cached_tokens: 0},
  };
  assert.deepEqual(snapshotToChatEvents(snapshot), []);
});
