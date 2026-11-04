import assert from 'node:assert/strict';
import test from 'node:test';
import { stageAgentEvents } from '../src/stageAgentEvents.ts';
import type { TimelineMessage, TimelineOperation } from '../src/types.ts';

const message = (id: string, text: string): TimelineMessage => ({
  kind: 'message', item_id: id, started_seq: 1, role: 'assistant',
  content: [{type: 'text', text}], status: 'completed',
});
const tool = (status: 'running' | 'completed', output = ''): TimelineOperation => ({
  kind: 'operation', item_id: 'read-call', started_seq: 2, category: 'tool', name: 'read',
  arguments: {path: '/eval.jsonl'}, status, output: [{type: 'text', text: output}], thought: [], details: {},
});
const turn = (seq: number, items: (TimelineMessage | TimelineOperation)[]): TimelineOperation => ({
  kind: 'operation', category: 'subagent', item_id: `turn-${seq}`, started_seq: seq,
  name: 'eval', thought: [], status: 'completed', output: [], details: {}, activity: {items, truncated: false},
});

test('execute and report rounds share messages and real paired tool calls without phase sections', () => {
  const activity = stageAgentEvents([
    turn(3, [message('report', '**报告已保存**')]),
    turn(1, [message('start', '读取数据'), tool('completed', '四条样本')]),
  ]);
  assert.deepEqual(activity.events.map(event => event.kind), ['MessageEvent', 'ActionEvent', 'ObservationEvent', 'MessageEvent']);
  const action = activity.events[1], result = activity.events[2];
  assert.ok(action.kind === 'ActionEvent' && result.kind === 'ObservationEvent');
  assert.equal(action.tool_call.name, 'read');
  assert.deepEqual(action.tool_call.arguments, {path: '/eval.jsonl'});
  assert.equal(result.action_id, action.id);
  assert.equal(result.observation.to_llm_content?.[0].type, 'text');
  assert.equal(activity.truncated, false);
});

test('overlapping restored windows update the same tool identity without duplicate messages', () => {
  const activity = stageAgentEvents([
    turn(1, [message('start', '读取数据'), tool('running')]),
    turn(2, [message('start', '读取数据'), tool('completed', '读取完成'), message('end', '已结束')]),
  ]);
  assert.equal(activity.events.filter(event => event.kind === 'MessageEvent').length, 2);
  assert.equal(activity.events.filter(event => event.kind === 'ActionEvent').length, 1);
  const result = activity.events.find(event => event.kind === 'ObservationEvent');
  assert.equal(result?.observation.operation_status, 'completed');
});

test('legacy text stays a message and never becomes a fabricated tool call', () => {
  const legacy = {...turn(1, []), activity: null, output: [{type: 'text', text: 'terminal: printed from a document'}]} as TimelineOperation;
  const activity = stageAgentEvents([legacy]);
  assert.equal(activity.events.length, 1);
  assert.equal(activity.events[0].kind, 'MessageEvent');
  assert.ok(activity.events[0].kind === 'MessageEvent');
  assert.equal(activity.events[0].llm_message.content[0].type === 'text' && activity.events[0].llm_message.content[0].text, 'terminal: printed from a document');
});

test('the latest bounded activity window retains truncation information', () => {
  const window = turn(1, Array.from({length: 150}, (_, index) => message(`m${index}`, `消息 ${index}`)));
  const activity = stageAgentEvents([window]);
  assert.equal(activity.events.length, 128);
  assert.equal(activity.truncated, true);
  assert.equal(activity.events.at(-1)?.kind, 'MessageEvent');
});
