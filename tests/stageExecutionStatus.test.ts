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
  } finally { await server.close(); }
});
