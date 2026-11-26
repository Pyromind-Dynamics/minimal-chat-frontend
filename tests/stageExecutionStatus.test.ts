import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { executionProgressLabel, type ExperimentExecution } from '../src/experimentExecutions.ts';

const run: ExperimentExecution = {
  run_id: 'run1', project_id: 'project', plan_revision: null, task_id: 'task',
  stage_id: 'stage', task_name: 'Task', role_id: 'worker', state: 'waiting_platform',
  report_state: 'not_started', fingerprint: null, proposal: null, metrics: null,
  platform_task_id: 'platform-task', artifacts: [],
};

test('stage states distinguish platform waiting, analysis and delivery', () => {
  for (const [state, expected] of [
    ['waiting_platform', '等待平台结果'],
    ['waiting_analysis', '结果已返回 · 等待分析与交付'],
    ['analyzing', '正在分析平台结果'],
    ['agent_completed', '本轮已结束 · 等待交付报告'],
    ['reported', '已交付报告'],
    ['cancel_requested', '取消中'],
    ['cancelled', '已取消'],
  ]) {
    assert.equal(executionProgressLabel({...run, state}), expected);
  }
  assert.equal(executionProgressLabel({...run, state: 'succeeded', report_state: 'not_started'}), '已完成');
  assert.equal(executionProgressLabel({...run, state: 'succeeded', report_state: 'registering'}), '执行已完成 · 正在登记产物');
  assert.equal(executionProgressLabel({...run, state: 'succeeded', report_state: 'registration_failed'}), '执行已完成 · 产物登记失败');
  assert.equal(executionProgressLabel({...run, state: 'succeeded', report_state: 'ready'}), '已交付报告');
  assert.equal(executionProgressLabel({...run, state: 'succeeded', report_state: 'queued'}), '执行已完成 · 正在生成报告');
  assert.equal(executionProgressLabel({...run, state: 'succeeded', report_state: 'failed'}), '已成功 · 报告失败');
});

test('current stage workspace displays blocked artifact delivery without old controls', async () => {
  const server = await createServer({define: {'window.location.host': JSON.stringify('localhost:5173')},
    server: {middlewareMode: true, ws: false}, optimizeDeps: {noDiscovery: true, include: []}, appType: 'custom'});
  try {
    const {StageWorkspace} = await server.ssrLoadModule('/src/components/StageWorkspace.tsx');
    const html = renderToStaticMarkup(createElement(StageWorkspace, {snapshot: {
      conversation_id: 'chat',
      project: {project_id: 'project', plan: {goal: 'Workflow', stages: [{id: 'stage', name: 'Stage', enabled: true}], edges: []}},
      experiment_executions: [{...run, state: 'waiting_artifacts', report_state: 'failed',
        waiting_reason: "artifact 'val_data' is not readable: /workspace/val.jsonl"}],
      timeline: [],
    }}));
    assert.match(html, /产物登记失败/);
    assert.match(html, /role="alert"/);
    assert.match(html, /\/workspace\/val.jsonl/);
    assert.doesNotMatch(html, /仅重试报告|核对并绑定|后台工作队列/);

    // Main-agent tool events can carry the same Studio task ID as the stage execution.
    const train = {...run, task_name: '训练并合并', role_id: 'main', platform_task_id: '1320',
      state: 'succeeded', report_state: 'registering'};
    const trainWorkspace = renderToStaticMarkup(createElement(StageWorkspace, {
      snapshot: {conversation_id: 'chat', timeline: [],
        project: {project_id: 'project', plan: {goal: 'Train', edges: [],
          stages: [{id: 'stage', name: 'Train', enabled: true}]}},
        experiment_executions: [train]},
      events: [{kind: 'ActionEvent', id: 'inspect', task_id: '1320',
        tool_call: {name: 'inspect_workflow_task', arguments: {}}}], options: {},
    }));
    assert.match(trainWorkspace.split('</ol>')[0], /已完成/);
    assert.match(trainWorkspace, /正在登记产物/);
    assert.match(trainWorkspace, /Studio 任务 #1320/);
    assert.doesNotMatch(trainWorkspace, /任务执行详情|个步骤|inspect_workflow_task/);

    const {ObservationFormSection} = await server.ssrLoadModule('/src/components/observations/ObservationFormSection.tsx');
    const sidebar = renderToStaticMarkup(createElement(ObservationFormSection, {
      section: {id: 'report', label: 'Dataset', selection: 'analysis_version',
        blocks: [{type: 'status', subject: '数据准备', source: 'report'}]},
      node: {id: 'stage', type: 'dataset', business_status: 'succeeded', delivery_status: 'failed',
        delivery_error: 'invalid_report', current_run_ids: ['run1'], report_version_ids: []},
      status: 'failed', reports: [], bindings: [], configVersion: '1',
      projectId: 'project', client: {}, options: {},
    }));
    assert.match(sidebar, /产物登记失败/);
    assert.doesNotMatch(sidebar, /数据准备执行失败/);

    const model = {...run, role_id: 'main', task_id: 'model', task_name: '评测合并模型',
      state: 'needs_input', platform_task_id: '1272'};
    const analysis = {...run, role_id: 'main', run_id: 'run2', task_id: 'analysis', task_name: '评测结果分析',
      state: 'succeeded', platform_task_id: null};
    const snapshot = {conversation_id: 'chat', timeline: [],
      project: {project_id: 'project', plan: {goal: 'Evaluate', edges: [],
        stages: [{id: 'stage', name: 'Eval', enabled: true}],
        tasks: [model, analysis].map(r => ({id: r.task_id, stage_id: 'stage'}))}},
      experiment_executions: [model, analysis]};
    const evaluation = renderToStaticMarkup(createElement(StageWorkspace, {snapshot}));
    assert.match(evaluation.split('<select')[0], /执行受阻/);
    assert.match(evaluation, /评测结果分析 · 已完成/);
    assert.doesNotMatch(evaluation, /第 [12] 次/);
    const retry = {...model, run_id: 'retry', state: 'succeeded', platform_task_id: '1273'};
    const repaired = renderToStaticMarkup(createElement(StageWorkspace, {
      snapshot: {...snapshot, experiment_executions: [model, analysis, retry]}}));
    assert.match(repaired, /第 2 次 · 评测合并模型 · 已完成/);
    assert.match(repaired, /Studio 任务 #1273/);
    assert.doesNotMatch(repaired.split('<select')[0], /执行受阻/);
  } finally { await server.close(); }
});

test('Main Agent interleaves public progress and collapsed tool activity before a platform task exists', async () => {
  const server = await createServer({define: {'window.location.host': JSON.stringify('localhost:5173')},
    server: {middlewareMode: true, ws: false}, optimizeDeps: {noDiscovery: true, include: []}, appType: 'custom'});
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = {getItem: () => null};
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: storage});
  Object.defineProperty(globalThis, 'window', {configurable: true,
    value: {location: {search: '?userId=42', href: 'http://localhost:5173/?chat=echomind'},
      localStorage: storage, matchMedia: () => ({matches: false})}});
  try {
    const {ChatProvider} = await server.ssrLoadModule('/src/ChatContext.tsx');
    const {ProductPlanningChat} = await server.ssrLoadModule('/src/components/ProductPlanningChat.tsx');
    const operation = (name: string, status: string, started_seq: number) => ({
      kind: 'operation', category: 'tool', item_id: name, name, status, started_seq,
      execution: null, thought: [], arguments: {command: name === 'terminal' ? 'RUNNING_COMMAND' : 'READ_COMMAND'},
      output: [{type: 'text', text: name === 'terminal' ? 'RUNNING_LINE_1\nRUNNING_LINE_2' : 'READ_LINE_1\nREAD_LINE_2'}],
      details: null, task_id: 'project-start', run_id: 'main-run',
    });
    const initialSnapshot = {
      conversation_id: 'main', status: 'running', through_seq: 5, pending_inputs: [], pending_permissions: [],
      capabilities: {read_only: false},
      project: {project_id: 'project', cluster: 'cn-east-1', plan: {goal: 'Prepare images', tasks: [], edges: [],
        stages: [{id: 'dataset', kind: 'dataset', name: 'Dataset', enabled: true}]}},
      experiment_executions: [{...run, stage_id: 'dataset', state: 'queued', platform_task_id: null}],
      timeline: [{
        kind: 'message', item_id: 'progress-first', role: 'assistant', project_reply: 'progress',
        content: [{type: 'text', text: 'PUBLIC_PROGRESS_FIRST'}], started_seq: 1, status: 'completed', task_id: 'project-start',
      }, operation('read_file', 'completed', 2), {
        kind: 'message', item_id: 'progress-second', role: 'assistant', project_reply: 'progress',
        content: [{type: 'text', text: 'PUBLIC_PROGRESS_SECOND'}], started_seq: 3, status: 'completed', task_id: 'project-start',
      }, operation('terminal', 'running', 4), {
        kind: 'message', item_id: 'private', role: 'assistant', content: [{type: 'text', text: 'PRIVATE_MODEL_REASONING'}],
        started_seq: 5, status: 'completed', task_id: 'project-start',
      }],
    };
    const html = renderToStaticMarkup(createElement(ChatProvider, {initialSnapshot},
      createElement(ProductPlanningChat, {client: {}, chatClient: {}, title: 'EchoMind', storageNamespace: 'test'})))
      .replaceAll('<!-- -->', '');
    const main = html.match(/<section aria-label="Main Agent 消息"[\s\S]*?<\/section>/)?.[0];
    assert.ok(main);
    assert.match(main, /PUBLIC_PROGRESS_FIRST.*调用工具 1 次.*PUBLIC_PROGRESS_SECOND.*正在运行命令…/);
    assert.match(main, /执行中/);
    const toolGroups = main.match(/<details\b[^>]*>.*?<\/details>/g) ?? [];
    assert.equal(toolGroups.length, 2);
    for (const group of toolGroups) assert.doesNotMatch(group, /<details[^>]*\bopen\b/);
    assert.doesNotMatch(main, /RUNNING_COMMAND|RUNNING_LINE_2|READ_LINE_1|READ_LINE_2/);
    assert.doesNotMatch(html, /PRIVATE_MODEL_REASONING|Studio 任务 #|工具执行日志/);
    assert.match(html, /调试与发布/);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    await server.close();
  }
});
