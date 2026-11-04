import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { canCreateProject, managerChatEvents, stageOperations } from '../src/preparation.ts';
import type { ChatEvent, ConversationSnapshot, TimelineOperation } from '../src/types.ts';

const snapshot = {
  conversation_id: 'chat', status: 'idle', pending_permissions: [], pending_inputs: [], timeline: [],
  preparation: {phase: 'ready', revision: 2, facts: {}, missing: [], review_pending: false, plan: null, policy: {fields: []}},
} as unknown as ConversationSnapshot;

test('creation is offered only for the current ready draft after the turn ends', () => {
  assert.equal(canCreateProject(snapshot), true);
  assert.equal(canCreateProject({...snapshot, status: 'running'}), false);
  assert.equal(canCreateProject({...snapshot, preparation: {...snapshot.preparation!, review_pending: true}}), false);
  assert.equal(canCreateProject({...snapshot, preparation: {...snapshot.preparation!, missing: ['dataset']}}), false);
  assert.equal(canCreateProject({...snapshot, pending_inputs: [{request_id: 'question', questions: []}]}), false);
});

test('stage projection uses business execution bindings and never the native run ID or role name', () => {
  const child = (project: string, stage: string, run: string) => ({kind: 'operation', category: 'subagent', item_id: run, run_id: 'native-shared-name', execution: {project_id: project, stage_id: stage, task_run_id: run, plan_sequence: 1}} as TimelineOperation);
  const state = {...snapshot, project: {project_id: 'project'} as ConversationSnapshot['project'], timeline: [child('project', 'init', 'business-one'), child('project', 'eval', 'business-two'), child('other', 'init', 'business-three')]};
  assert.deepEqual(stageOperations(state, 'init').map(item => item.execution?.task_run_id), ['business-one']);
});

test('preparation card and workspace render checklist, plan, creation and stage columns', async () => {
  const server = await createServer({define: {'window.location.host': JSON.stringify('localhost:5173')}, server: {middlewareMode: true, ws: false}, optimizeDeps: {noDiscovery: true, include: []}, appType: 'custom'});
  try {
    const {PreparationPanel} = await server.ssrLoadModule('/src/components/PreparationPanel.tsx');
    const {PreparationWelcome} = await server.ssrLoadModule('/src/components/PreparationWelcome.tsx');
    const welcome = renderToStaticMarkup(createElement(PreparationWelcome));
    assert.match(welcome, /收集信息/); assert.match(welcome, /审阅计划/); assert.match(welcome, /阶段执行/);
    const prep = {...snapshot, preparation: {...snapshot.preparation!, policy: {checklist_id: 'test', version: 1, fields: [{key: 'data', label: '评测数据', required: true, description: ''}]}, facts: {data: {status: 'resolved', value: '/eval.jsonl', evidence_refs: ['resource:evidence']}}, plan: {goal: 'Evaluate', resources: [], stages: [{id: 'eval', name: 'Eval', enabled: true}], tasks: [], edges: []}}};
    const html = renderToStaticMarkup(createElement(PreparationPanel, {snapshot: prep}));
    assert.match(html, /评测数据/); assert.match(html, /准备 Checklist/);
    const {PreparationPlanMessage} = await server.ssrLoadModule('/src/components/PreparationPlanMessage.tsx');
    const {ChatPanel} = await server.ssrLoadModule('/src/components/ChatPanel.tsx');
    const planMessage = createElement(PreparationPlanMessage, {snapshot: prep, busy: false, onCreate: () => {}});
    const chat = renderToStaticMarkup(createElement(ChatPanel, {events: [], requestOptions: {}, status: 'idle'}, planMessage));
    assert.match(chat, /workflowPLAN/); assert.match(chat, /创建并启动/); assert.match(chat, /尚未创建 Project/);
    assert.match(chat, /计划阶段 · 未启动/);
    const updating = renderToStaticMarkup(createElement(PreparationPlanMessage, {snapshot: {...prep, preparation: {...prep.preparation, review_pending: true}}, busy: false, onCreate: () => {}}));
    assert.match(updating, /正在更新草稿/); assert.doesNotMatch(updating, /<button/);
    const {StageWorkspace} = await server.ssrLoadModule('/src/components/StageWorkspace.tsx');
    const state = {...snapshot, project: {project_id: 'project', plan: {goal: 'Evaluate', resources: [], stages: [{id: 'init', name: 'Init', enabled: true}, {id: 'eval', name: 'Eval', enabled: true}], edges: [{source: 'init', target: 'eval'}]}}};
    const workspace = renderToStaticMarkup(createElement(StageWorkspace, {snapshot: state}));
    assert.match(workspace, /阶段 Init/); assert.match(workspace, /阶段 Eval/); assert.match(workspace, /repeat\(2, 360px\)/);
    assert.match(workspace, /工作流阶段依赖关系/); assert.match(workspace, /Init → Eval/);
    const {WorkflowPlanPreview} = await server.ssrLoadModule('/src/components/WorkflowPlanPreview.tsx');
    const previewPlan = {...state.project.plan, resources: [{id: 'data', name: '验证集', uri: '/eval.jsonl'}], tasks: [{id: 'task-eval', stage_id: 'eval', name: '小样评测', description: '仅评测', inputs: [{name: 'dataset', resource_id: 'data'}], outputs: [{name: 'metrics.json', description: '真实指标'}]}]};
    const preview = renderToStaticMarkup(createElement(WorkflowPlanPreview, {plan: previewPlan, entryTaskId: 'task-eval'}));
    assert.match(preview, /首个启动任务/); assert.match(preview, /小样评测/); assert.match(preview, /metrics.json/);
    assert.match(preview.replaceAll('<!-- -->', ''), /输入 dataset ← 验证集/);
    const initPlan = {...previewPlan, stages: [{id: 'baseline', kind: 'init', name: '自由标题', enabled: true}], tasks: [
      {...previewPlan.tasks[0], id: 'bench', stage_id: 'baseline', kind: 'bench'},
      {...previewPlan.tasks[0], id: 'analysis', stage_id: 'baseline', kind: 'analysis'},
    ], edges: []};
    const {WorkflowStageRow} = await server.ssrLoadModule('/src/components/WorkflowPlanPreview.tsx');
    const row = renderToStaticMarkup(createElement(WorkflowStageRow, {plan: initPlan, catalog: [{id: 'init', name: 'Init', roles: ['eval'], tasks: [{id: 'bench'}, {id: 'analysis'}]}]}));
    assert.equal((row.match(/data-stage-id=/g) ?? []).length, 1);
    assert.match(row, /Init/); assert.doesNotMatch(row, /自由标题|小样评测|metrics.json/);
    const runs = ['old', 'latest'].map((id, index) => ({run_id: id, stage_id: 'eval', task_name: `Eval ${id}`, state: index ? 'waiting_platform' : 'succeeded', report_state: 'not_started', artifacts: [], summary: index ? 'latest-run-detail' : 'old-run-detail'}));
    const history = renderToStaticMarkup(createElement(StageWorkspace, {snapshot: {...state, experiment_executions: runs}}));
    assert.match(history, /Eval 的执行记录/);
    assert.match(history, /等待平台/);
    assert.doesNotMatch(history, /任务与报告|latest-run-detail|old-run-detail/);
    const logTurns = ['execute', 'report'].map((phase, index) => ({
      kind: 'operation', category: 'subagent', item_id: phase, name: 'eval', started_seq: index + 1,
      status: 'completed', output: [], execution: {project_id: 'project', stage_id: 'eval', task_run_id: 'latest'},
      details: {subagent: {version: 1, phase}},
      activity: {truncated: false, items: [{
        kind: 'message', item_id: `message-${phase}`, started_seq: 1, role: 'assistant', status: 'completed',
        content: [{type: 'text', text: index ? '**报告已保存**' : '预测已完成'}],
      }, ...(index ? [] : [{
        kind: 'operation', item_id: 'tool-read', started_seq: 2, name: 'read', category: 'tool',
        status: 'completed', arguments: {path: '/eval.jsonl'}, output: [{type: 'text', text: '已读取四条数据'}], thought: [],
      }])]},
    }));
    const continuous = renderToStaticMarkup(createElement(StageWorkspace, {snapshot: {...state, experiment_executions: runs, timeline: logTurns}}));
    assert.equal((continuous.match(/role="log"/g) ?? []).length, 1);
    assert.match(continuous, /预测已完成/); assert.match(continuous, /报告已保存/);
    assert.match(continuous, /<strong>报告已保存<\/strong>/);
    assert.match(continuous, /read/); assert.match(continuous, /已读取四条数据/);
    assert.doesNotMatch(continuous, /此前运行|执行过程|整理结果|第 2 轮|任务与报告/);
    const {ToolCallBlock} = await server.ssrLoadModule('/src/components/ToolCallBlock.tsx');
    const tool = renderToStaticMarkup(createElement(ToolCallBlock, {
      action: {tool_call: {name: 'inspect_resource', arguments: {uri: '/eval.jsonl'}}},
      observation: {observation: {content: 'preview text', to_llm_content: [{type: 'text', text: '4 rows; truncated'}]}},
      requestOptions: {},
    }));
    assert.match(tool, /inspect_resource/); assert.match(tool, /4 rows; truncated/);
  } finally {await server.close();}
});

test('manager chat omits both child actions and their paired observations', () => {
  const events = [{kind: 'ActionEvent', id: 'child', category: 'subagent'}, {kind: 'ObservationEvent', id: 'child-result', action_id: 'child'}, {kind: 'MessageEvent', id: 'manager'}, {kind: 'ActionEvent', id: 'manager-tool', category: 'tool'}] as ChatEvent[];
  assert.deepEqual(managerChatEvents(events).map(event => event.id), ['manager', 'manager-tool']);
});
