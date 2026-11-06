import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { executionLabel, executionProgressLabel, stageExecutionLabel, type ExperimentExecution } from '../src/experimentExecutions.ts';

const run: ExperimentExecution = {
  run_id: 'run1', project_id: 'project', plan_revision: 1, task_id: 'baseline',
  stage_id: 'init', task_name: '基模评测', role_id: 'evaluator', state: 'submission_uncertain',
  report_state: 'not_started', fingerprint: null, proposal: null, metrics: null,
  platform_task_id: null, artifacts: [],
};

test('stage state comes from executions and cancellation requests stay pending', () => {
  assert.equal(stageExecutionLabel([], 'init'), '尚未执行');
  assert.equal(stageExecutionLabel([run], 'init'), '提交结果待核对');
  assert.equal(stageExecutionLabel([run], 'data'), '尚未执行');
  assert.equal(executionLabel('cancel_requested'), '取消中');
  assert.equal(executionLabel('cancelled'), '已取消');
});

test('advisory stages can link earlier executions without guessing from names', () => {
  const completed = { ...run, plan_revision: null, stage_id: null, state: 'succeeded', report_state: 'ready' };
  assert.equal(stageExecutionLabel([completed], 'later-stage', ['run1'], '未关联执行'), '已成功');
  assert.equal(stageExecutionLabel([completed], 'later-stage', [], '未关联执行'), '未关联执行');
  assert.equal(stageExecutionLabel([completed], 'later-stage', ['another-run'], '未关联执行'), '未关联执行');
});

test('a reference graph created after a report shows its explicitly linked execution', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  try {
    const { ExperimentPlanPanel } = await server.ssrLoadModule('/src/components/ExperimentPlanPanel.tsx');
    const context = { goal: '先执行、事后整理', stages: [{id: 'later-stage', name: '小样评测', description: '', enabled: true, placeholder: false}], edges: [], conclusions: [], status: 'completed' };
    const props = { view: null, contextView: {project_id: 'project', sequence: 1, context}, exploration: true, selectedRevision: null, busy: false, onDecision: () => {}, onHistory: () => {}, onRefresh: () => {}, executions: [{...run, stage_id: null, plan_revision: null, state: 'succeeded', report_state: 'ready'}] };
    const unlinked = renderToStaticMarkup(createElement(ExperimentPlanPanel, props));
    assert.match(unlinked, /未关联执行/);
    assert.ok(!unlinked.includes('尚未执行'));
    const linked = renderToStaticMarkup(createElement(ExperimentPlanPanel, {...props, contextView: {...props.contextView, context: {...context, stage_executions: {'later-stage': ['run1']}}}}));
    assert.match(linked, /小样评测 · 已成功/);
    assert.ok(!linked.includes('未关联执行') && !linked.includes('尚未执行'));
    assert.ok(!linked.includes('确认创建') && !linked.includes('确认更新'));
  } finally { await server.close(); }
});

test('execution details show uncertain submissions and historical results without invented metrics', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  try {
    const { ExperimentExecutionPanel } = await server.ssrLoadModule('/src/components/ExperimentExecutionPanel.tsx');
    const pending = renderToStaticMarkup(createElement(ExperimentExecutionPanel, { executions: [run], revision: 2 }));
    assert.match(pending, /平台可能已经受理/);
    assert.match(pending, /历史计划的执行结果/);
    assert.ok(!pending.includes('真实评测指标'));
    const completed = renderToStaticMarkup(createElement(ExperimentExecutionPanel, {
      executions: [{ ...run, state: 'succeeded', report_state: 'failed', metrics: { accuracy: 0.93 } }], revision: 1,
    }));
    assert.match(completed, /0.93/);
    assert.match(completed, /生成失败/);
    assert.match(completed, /已成功/);
    const standalone = renderToStaticMarkup(createElement(ExperimentExecutionPanel, {
      executions: [{ ...run, plan_revision: null, waiting_reason: '等待重新授权' }], revision: null,
      onResolve: async () => {}, onControl: async () => {},
    }));
    assert.match(standalone, /核对并绑定/);
    assert.match(standalone, /终止本次跟踪/);
    assert.match(standalone, /等待重新授权/);
    assert.ok(!standalone.includes('历史计划的执行结果'));
  } finally { await server.close(); }
});


test('sample and workflow waits remain attached to their business stage', () => {
  assert.equal(executionLabel('waiting_user'), '等待用户确认');
  assert.equal(executionLabel('waiting_confirmation'), '等待工作流确认');
  assert.equal(executionLabel('preparing'), '准备执行');
  assert.equal(stageExecutionLabel([{...run, stage_id: 'dataset', state: 'waiting_user'}], 'dataset'), '等待用户确认');
});

test('checkpoint confirmation reuses the existing ask_user form', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  try {
    const { UserInputCard } = await server.ssrLoadModule('/src/components/UserInputCard.tsx');
    const html = renderToStaticMarkup(createElement(UserInputCard, {
      request: {request_id: 'review-1', checkpoint: {run_id: 'data-1', checkpoint_id: 'sample-1'}, questions: [{id: 'sample_review', prompt: '这三条清洗结果是否符合要求？', options: [{id: 'confirm_full', label: '确认并全量清洗'}, {id: 'revise', label: '修改要求'}]}]},
      onRespond: async () => {},
    }));
    assert.match(html, /需要你确认/);
    assert.match(html, /确认并全量清洗/);
    assert.match(html, /修改要求/);
    assert.match(html, /回答 Agent 的问题/);
    assert.equal((html.match(/<form /g) ?? []).length, 1);
    assert.ok(!html.includes('任务与报告'));
  } finally { await server.close(); }
});

test('stage conversation status keeps result and reporting outcomes distinct', () => {
  assert.equal(executionProgressLabel({...run, state: 'succeeded', report_state: 'queued'}), '执行已完成 · 正在生成报告');
  assert.equal(executionProgressLabel({...run, state: 'succeeded', report_state: 'failed'}), '已成功 · 报告失败');
  assert.equal(executionProgressLabel({...run, state: 'succeeded', report_state: 'ready'}), '已成功');
});

test('artifact collection and failed registration are distinct from user confirmation', async () => {
  const collecting = {...run, plan_revision: null, stage_id: 'dataset', state: 'waiting_artifacts', report_state: 'queued'};
  const failed = {...collecting, report_state: 'failed', waiting_reason: "artifact 'val_data' is not readable: /datasets/val.jsonl"};
  assert.equal(executionProgressLabel(collecting), '正在整理产物');
  assert.equal(executionProgressLabel(failed), '产物登记失败');
  assert.equal(stageExecutionLabel([failed], 'dataset'), '产物登记失败');
  const server = await createServer({ define: {'window.location.host': JSON.stringify('localhost:5173')}, server: { middlewareMode: true, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  try {
    const { ExperimentExecutionPanel } = await server.ssrLoadModule('/src/components/ExperimentExecutionPanel.tsx');
    const details = renderToStaticMarkup(createElement(ExperimentExecutionPanel, {
      executions: [failed], revision: null, onControl: async () => {},
    }));
    assert.match(details, /产物登记失败/);
    assert.match(details, /val_data/);
    assert.match(details, /仅重试报告/);
    assert.ok(!details.includes('等待用户确认'));
    const { StageWorkspace } = await server.ssrLoadModule('/src/components/StageWorkspace.tsx');
    const stage = renderToStaticMarkup(createElement(StageWorkspace, {
      snapshot: {
        project: {project_id: 'project', plan: {goal: 'Train', stages: [{id: 'dataset', name: 'Dataset', enabled: true}], edges: []}},
        experiment_executions: [failed], timeline: [],
      },
    }));
    assert.match(stage, /产物登记失败/);
    assert.match(stage, /role="alert"/);
    assert.match(stage, /\/datasets\/val.jsonl/);
  } finally { await server.close(); }
});
