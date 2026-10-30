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
  } finally { await server.close(); }
});
