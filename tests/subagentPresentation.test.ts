import assert from 'node:assert/strict';
import test from 'node:test';
import { groupSubagentOperations, readableResult, subagentStatus } from '../src/subagentPresentation.ts';
import { snapshotToChatEvents } from '../src/productSnapshot.ts';
import type { ConversationSnapshot, TimelineOperation } from '../src/types.ts';

const operation = (id: string, category: TimelineOperation['category'], details: unknown = {}, args: unknown = {}): TimelineOperation => ({
  kind: 'operation', item_id: id, started_seq: 1, name: 'subagent', category, status: 'running',
  thought: [], arguments: args, output: [], details,
});
test('only proven correlations merge launch and controls; failures remain visible', () => {
  const child = operation('subagent:run', 'subagent', { subagent: { version: 1, run_id: 'run', tool_call_id: 'launch' } });
  const ops = [operation('launch', 'tool'), child, operation('failed-launch', 'tool'),
    operation('status', 'tool', {}, { action: 'status', id: 'run' }),
    operation('other', 'tool', {}, { action: 'stop', id: 'other' }),
    operation('resume', 'tool', {}, { action: 'resume', id: 'run' })];
  const groups = groupSubagentOperations(ops);
  assert.deepEqual([...groups.hidden], ['launch', 'status']);
  assert.equal(groups.related.get(child.item_id)?.length, 2);
  const events = snapshotToChatEvents({ timeline: ops } as ConversationSnapshot);
  assert.equal(events.filter(event => event.kind === 'ActionEvent' && event.category === 'subagent').length, 1);
  assert.equal(events.some(event => 'id' in event && event.id === 'failed-launch'), true);
});
test('snapshot keeps trace metadata, accurate state and timestamps on refresh', () => {
  const details = { subagent: { version: 1, status: 'stopped', started_at: '2026-10-15T00:00:00Z', ended_at: '2026-10-15T00:00:05Z', trace: { text: 'Tool: read', availability: 'available' } } };
  const child = { ...operation('child', 'subagent', details), status: 'failed' } as TimelineOperation;
  const events = snapshotToChatEvents({ timeline: [child] } as ConversationSnapshot);
  assert.ok(events[0].kind === 'ActionEvent');
  assert.equal(events[0].category, 'subagent');
  assert.deepEqual(events[0].details, details);
  assert.equal(events[0].timestamp, details.subagent.started_at);
});
test('legacy results extract text without leaking arbitrary JSON fields', () => {
  assert.equal(readableResult('{"content":[{"type":"text","text":"Evidence"}],"private":"hidden"}'), 'Evidence');
  assert.equal(readableResult('ordinary text'), 'ordinary text');
});

test('resumed runs share one stable card with the latest status and retained history', () => {
  const first = { ...operation('subagent:first', 'subagent', { subagent: {
    version: 1, run_id: 'first', task: 'Inspect the dataset', phase: 'execute', status: 'complete',
  } }), name: 'search', status: 'completed', completed_seq: 2,
    output: [{ type: 'text', text: 'Submission evidence' }] } as TimelineOperation;
  const second = { ...operation('subagent:second', 'subagent', { subagent: {
    version: 1, run_id: 'second', previous_run_id: 'first', task: 'Inspect the dataset', phase: 'report', status: 'running',
  } }), name: 'search', started_seq: 4 };
  const unrelated = { ...operation('subagent:other', 'subagent'), name: 'search', started_seq: 3 };
  const snapshot = { timeline: [first, unrelated, second] } as ConversationSnapshot;
  const events = snapshotToChatEvents(snapshot);
  const actions = events.filter(event => event.kind === 'ActionEvent');
  assert.equal(actions.length, 2);
  assert.equal(actions[0].id, first.item_id);
  assert.deepEqual(actions[0].subagent_runs, [first, second]);
  const observation = events[1];
  assert.ok(observation.kind === 'ObservationEvent');
  assert.equal(observation.action_id, first.item_id);
  assert.equal(observation.observation.operation_status, 'running');
  second.status = 'completed';
  const refreshed = snapshotToChatEvents(snapshot);
  assert.ok(refreshed[0].kind === 'ActionEvent' && refreshed[1].kind === 'ObservationEvent');
  assert.equal(refreshed[0].id, first.item_id);
  assert.equal(refreshed[1].observation.operation_status, 'completed');
  assert.equal(first.output[0].type === 'text' && first.output[0].text, 'Submission evidence');
});

test('unproven, cyclic or different-role links never hide independent runs', () => {
  const make = (id: string, previous: string, seq: number, name = 'search') => ({
    ...operation(id, 'subagent', { subagent: { version: 1, run_id: id, previous_run_id: previous } }),
    name, started_seq: seq,
  });
  const ops = [make('self', 'self', 1), make('earlier', 'later', 2),
    make('later', 'earlier', 3, 'general_purpose'), make('missing', 'absent', 4)];
  assert.equal(groupSubagentOperations(ops).hidden.size, 0);
});

test('run chains retain independent tasks and resolve the latest round status', () => {
  const run = (id: string, state: string, seq: number, previous?: string) => ({
    ...operation(id, 'subagent', { subagent: { version: 1, run_id: id, role: 'search',
      status: state, previous_run_id: previous } }), started_seq: seq,
  });
  const paused = { ...run('old', 'paused', 1), status: 'failed' as const, error_code: 'subagent_paused' };
  const olderQueue = run('older', 'queued', 2);
  const resumed = run('new', 'queued', 3, 'old');
  const unknown = operation('legacy', 'subagent');
  const rejected = { ...operation('rejected', 'tool'), status: 'failed' as const };
  assert.equal(subagentStatus(paused.details, paused.status, paused.error_code), 'paused');
  const summary = groupSubagentOperations([paused, olderQueue, resumed, unknown, rejected]);
  assert.deepEqual([...summary.runs.values()], [[paused, resumed], [unknown], [olderQueue]]);
  assert.equal(subagentStatus(unknown.details, unknown.status), 'unknown');
  const running = run('new', 'running', 3, 'old');
  assert.deepEqual(groupSubagentOperations([paused, running]).runs.get('old'), [paused, running]);
  for (const [status, error_code] of [['completed', undefined], ['failed', 'subagent_stopped'], ['failed', 'subagent_failed']] as const) {
    assert.equal(subagentStatus(running.details, status, error_code), error_code?.replace('subagent_', '') ?? status);
  }
});
