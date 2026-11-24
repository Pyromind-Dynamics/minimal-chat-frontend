import assert from 'node:assert/strict';
import test from 'node:test';
import { groupEchoMindTurns, visibleExecutionEvents } from '../src/echomindConversationPresentation.ts';
import { snapshotToChatEvents } from '../src/productSnapshot.ts';
import { projectMessageEvents } from '../src/productMessages.ts';
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

test('late notices follow chat arrival order and keep execution details with the original turn', () => {
  const chat = snapshot([
    { ...message('task', 1, 'user', 'a'), turn_id: 'a' },
    { ...message('other', 2, 'user', 'b'), turn_id: 'b' },
    { ...message('reply', 3, 'assistant', 'b'), turn_id: 'b' },
  ], { through_seq: 3 });
  const projected = projectMessageEvents(chat, [{
    schema_version: 1, conversation_id: chat.conversation_id, event_id: 'notice', seq: 4,
    occurred_at: '2026-11-23T12:00:00Z', type: 'message.completed',
    payload: {
      message_id: 'notice', role: 'assistant', content: [{type: 'text', text: '报告已生成'}],
      execution_notice: {origin_turn_id: 'a'},
    },
  }, {
    schema_version: 1, conversation_id: chat.conversation_id, event_id: 'continuation', seq: 5,
    occurred_at: '2026-11-23T12:00:01Z', type: 'message.completed', turn_id: 'b',
    payload: {message_id: 'continuation', role: 'assistant', content: [{type: 'text', text: '补充回复'}]},
  }]);
  const { entries, turns } = group(projected, snapshot([], {task_origins: {task: 'a'}}));
  assert.deepEqual(entries.map(entry => entry.kind === 'notice'
    ? [entry.message.id, entry.message.execution_notice?.origin_turn_id]
    : entry.messages.map(event => 'id' in event ? event.id : '')), [
    ['task'], ['other', 'reply'], ['notice', 'a'], ['continuation'],
  ]);
  assert.deepEqual(turns.map(turn => [turn.id, turn.progress.length]), [['a', 1], ['b', 0]]);
});

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
  assert.equal(turns[0].progress[0].status, '排队中');
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
  assert.equal(turns[1].progress[0].status, '排队中');
  assert.deepEqual(turns[1].execution, []);
  assert.deepEqual(background, []);
});

test('a silent execution updates its original turn from queue through the platform callback', () => {
  const root = 'requirement:chat:one';
  const chat = snapshot([
    { ...message('start', 1, 'user', 'chat-a'), turn_id: 'first' },
    { ...message('check', 2, 'user', 'chat-b'), turn_id: 'second' },
  ]);
  function status(extra: Partial<ConversationSnapshot>) {
    const { turns } = group(chat, snapshot([], { task_origins: { [root]: 'first' }, ...extra }));
    assert.deepEqual(turns[1].progress, []);
    assert.equal(turns[0].progress[0].id, root);
    return turns[0].progress[0];
  }
  const originalRuns = { 'worker-run': { task_id: root, status: 'running' as const, seq: 3 } };
  assert.equal(status({ experiment_queue: [{ task_id: root, kind: 'requirement' }] }).status, '排队中');
  assert.equal(status({ task_runs: originalRuns }).status, '执行中');
  const task = { task_id: 'platform', run_id: 'worker-run', status: 'running' };
  assert.equal(status({ task_runs: originalRuns, external_tasks: [task] }).status, '等待平台结果');
  const ended = { 'worker-run': { ...originalRuns['worker-run'], status: 'idle' as const, seq: 4 } };
  assert.equal(status({ task_runs: ended, external_tasks: [{ ...task, status: 'succeeded' }] }).status,
    '结果已返回 · 等待分析与交付');
  const callback = { ...ended, 'analysis-run': { task_id: 'platform', status: 'idle' as const, seq: 7 } };
  assert.equal(status({ task_runs: callback, external_tasks: [{ ...task, status: 'succeeded' }] }).status,
    '已结束');
  const failure = status({ task_runs: ended, external_tasks: [{ ...task, status: 'failed', error_summary: '数据缺失' }] });
  assert.equal(failure.status, '执行失败');
  assert.equal(failure.reason, '数据缺失');
});

test('a finished requirement and an active project on the same turn have separate labels', () => {
  const chat = snapshot([{ ...message('input', 1, 'user', 'a'), turn_id: 'a' }]);
  const task = 'requirement:chat:one';
  const start = 'project-start:project';
  const execution = snapshot([], {
    task_origins: { [task]: 'a', [start]: 'a' },
    task_runs: {
      request: { task_id: task, status: 'idle', seq: 5 },
      start: { task_id: start, status: 'running', seq: 6 },
    },
  });
  const progress = group(chat, execution).turns[0].progress;
  assert.deepEqual(progress.map(item => [item.title, item.status, !!item.settled]), [
    ['需求处理', '已结束', true], ['项目启动', '执行中', false],
  ]);
});

test('multiple requests on one turn remain individually identifiable', () => {
  const chat = snapshot([{ ...message('input', 1, 'user', 'a'), turn_id: 'a' }]);
  const execution = snapshot([], {
    task_origins: { 'requirement:chat:1': 'a', 'requirement:chat:2': 'a' },
  });
  assert.deepEqual(group(chat, execution).turns[0].progress.map(item => item.title),
    ['需求处理 1', '需求处理 2']);
});

test('project stage callbacks use shared execution status and automatic runs stay in stage history', () => {
  const root = 'requirement:chat:one';
  const chat = snapshot([{ ...message('start', 1, 'user', 'chat'), turn_id: 'first' }]);
  const execution = snapshot([
    operation('automatic', 1, 'project-start'),
    { ...operation('manual-callback', 3, 'receipt-analysis'), task_id: 't-1' },
  ], {
    task_origins: { [root]: 'first' },
    project: { project_id: 'p', conversation_id: 'session', plan_sequence: 1, creation_command_id: 'created',
      plan: { goal: 'Project', stages: ['train', 'eval'].map(stage => ({ id: stage, name: stage, description: '', enabled: true, placeholder: false })),
        constraints: [], resources: [], edges: [], blockers: [], conclusions: [], next_steps: [], status: 'active' } },
    task_runs: { 'work': { task_id: root, status: 'idle', seq: 4 } },
    external_tasks: [
      { task_id: 't-0', run_id: 'work', status: 'failed' },
      { task_id: 't-1', run_id: 'work', status: 'succeeded' },
      { task_id: 't-2', run_id: 'project-start', status: 'succeeded' },
    ],
    experiment_executions: [
      { run_id: 'manual-attempt-1', task_id: 'evaluation', project_id: 'p', stage_id: 'eval', task_name: '评测', role_id: 'main',
        state: 'failed', report_state: 'not_started', waiting_reason: '平台执行失败', platform_task_id: 't-0',
        plan_revision: null, fingerprint: null, proposal: null, metrics: null, artifacts: [] },
      { run_id: 'manual', task_id: 'evaluation', project_id: 'p', stage_id: 'eval', task_name: '评测', role_id: 'main',
        state: 'needs_input', report_state: 'not_started', waiting_reason: '缺少推理回执', platform_task_id: 't-1',
        plan_revision: null, fingerprint: null, proposal: null, metrics: null, artifacts: [] },
      { run_id: 'automatic', task_id: 'training', project_id: 'p', stage_id: 'train', task_name: '训练', role_id: 'main',
        state: 'reported', report_state: 'ready', platform_task_id: 't-2',
        plan_revision: null, fingerprint: null, proposal: null, metrics: null, artifacts: [] },
    ],
    pending_inputs: [{ request_id: 'confirmation', run_id: 'work', questions: [] }],
  });
  const { turns, background } = group(chat, execution);
  assert.deepEqual(background, []);
  assert.equal(turns[0].execution.length, 2);
  assert.equal(turns[0].progress[0].status, '执行受阻');
  assert.equal(turns[0].progress[0].reason, '缺少推理回执');
  assert.deepEqual(turns[0].progress[0].attempts?.map(item => item.status), ['已失败', '执行受阻']);
  assert.equal(turns[0].needsConfirmation, true);
});


test('the main activity view omits model text and tool thoughts, preserving user inputs and errors', () => {
  const privateText = 'private reasoning';
  const execution = snapshot([
    message('original-user-message', 1, 'user', 'run'),
    message(privateText, 2, 'assistant', 'run'),
    operation('visible-tool', 3, 'run', { thought: [{ type:'text', text:privateText }] }),
    { kind: 'notice', item_id: 'failed', started_seq: 4, severity: 'error', code: 'failed', message: '任务失败' },
  ]);
  const visible = visibleExecutionEvents(snapshotToChatEvents(execution));
  assert.deepEqual(visible.map(event => event.kind), ['MessageEvent', 'ActionEvent', 'ObservationEvent', 'ServerErrorEvent']);
  assert.equal(JSON.stringify(visible).includes(privateText), false);
  assert.match(JSON.stringify(visible), /任务失败/);
});

test('a late submission receipt shows the actual terminal status of just its own jobs', () => {
  const chat = snapshot(['submitted', 'callback'].map((run, index) => ({
    ...message(run, index + 1, 'assistant', run), execution_notice: { has_result: true },
  })));
  const submit = (id: string, task: string, status: TimelineOperation['status'] = 'completed') =>
    operation(id, 3, 'submitted', { name: 'submit_workflow', status, details: { task_id: task } });
  const manager = snapshot([
    submit('a', '1291'), submit('b', '1291'), submit('c', '1292', 'failed'), submit('d', '1293'),
  ], { external_tasks: [
    { task_id: '1291', status: 'failed' }, { task_id: '1292', status: 'succeeded' },
    { task_id: '1293', status: 'pending' },
  ] });
  const statuses = group(chat, manager).entries.flatMap(entry => entry.kind === 'notice' ? [entry.receiptStatuses] : []);
  assert.deepEqual(statuses, [['平台任务 1291 已失败'], []]);
});

test('recovered milestones keep their original time across an interleaved chat turn', () => {
  const at = (i: number) => new Date(1000 * i).toISOString();
  const chat = snapshot([
    { ...message('question', 1, 'user', 'a'), started_at: at(1) },
    { ...message('other', 2, 'user', 'b'), started_at: at(3) },
    { ...message('final', 3, 'assistant', 'a'), started_at: at(4),
      execution_notice: { source_message_id: 'main-final' } },
    { ...message('report', 4, 'assistant', 'a'), started_at: at(6),
      execution_notice: { source_message_id: 'main-report', history_timestamp: at(2) } },
  ]);
  const rows = group(chat, snapshot([])).entries.flatMap(e =>
    e.kind === 'notice' ? [e.message.id] : e.messages.map(m => 'id' in m ? m.id : ''));
  assert.deepEqual(rows, ['question', 'report', 'other', 'final']);
});

test('adjacent revisions of one report share a notice and keep both targets', () => {
  const notice = (id: string, seq: number, run = 'run') => ({
    ...message(id, seq, 'assistant', run),
    execution_notice: { origin_turn_id: 'a', action: 'report' as const, target_id: id },
  });
  const manager = snapshot(['v255', 'v256', 'v257'].map((id, i) =>
    operation(id, i + 1, 'run', { name: 'product_versions', status: 'completed',
      details: { id, kind: 'report', logical_key: i < 2 ? 'prepare_data/evidence_report' : 'baseline/result', version_no: i + 1 } })));
  const chat = snapshot([notice('v255', 1), notice('v256', 2), notice('v257', 3), notice('v255', 4, 'other')]);
  assert.deepEqual(group(chat, manager).entries.map(e => e.kind === 'notice' && e.reports?.map(r => r.id)),
    [['v256', 'v255'], ['v257'], ['v255']]);
});
