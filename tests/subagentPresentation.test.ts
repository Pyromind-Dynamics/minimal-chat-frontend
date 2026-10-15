import assert from 'node:assert/strict';
import test from 'node:test';
import { groupSubagentOperations, readableResult } from '../src/subagentPresentation.ts';
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
