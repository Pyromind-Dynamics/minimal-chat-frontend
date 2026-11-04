import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { executionLabel, stageExecutionLabel, type ExperimentExecution } from '../src/experimentExecutions.ts';

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
