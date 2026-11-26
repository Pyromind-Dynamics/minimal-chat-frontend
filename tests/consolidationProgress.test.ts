import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {latestGraphConsolidationJob, type ConsolidationJob, type ConsolidationState} from '../src/echomindRuntime.ts';

function state(): ConsolidationState {
  const job = (id: string, plan: number, created: string): ConsolidationJob => ({
    job_id: id, scope: 'graph', stage_id: null, objective: '验证执行方案', revision: 2,
    plan_sequence: plan, status: 'paused', task_ids: {}, blockers: [],
    repair_command_id: null, waiting_reason: '等待继续', created_at: created, updated_at: created,
  });
  return {
    revision: 4, conversation_id: 'chat', project_id: 'project', plan_sequence: 2,
    project_goal: '完成图片训练飞轮',
    stages: {dataset: {stage_id: 'dataset', current_revision: 2, status: 'verified', selected_delivery_id: 'delivery-2'}},
    jobs: {
      old: {...job('old', 1, '2026-11-24T10:00:00Z'), updated_at: '2026-11-24T13:00:00Z'},
      first: job('first', 2, '2026-11-24T11:00:00Z'),
      current: job('current', 2, '2026-11-24T12:00:00Z'),
    },
  };
}

test('consolidation progress selects the newest job within the current plan', () => {
  const snapshot = state();
  assert.equal(latestGraphConsolidationJob(snapshot)?.job_id, 'current');
  assert.equal(latestGraphConsolidationJob({...snapshot, plan_sequence: 3}), null);
});

test('progress distinguishes stage delivery from execution checks and offers resume', async () => {
  const server = await createServer({
    define: {'window.location.host': JSON.stringify('localhost:5173')},
    server: {middlewareMode: true, ws: false}, optimizeDeps: {noDiscovery: true, include: []}, appType: 'custom',
  });
  try {
    const {ConsolidationProgress} = await server.ssrLoadModule('/src/components/ExecutionPlanConsolidation.tsx');
    const html = renderToStaticMarkup(createElement(ConsolidationProgress, {state: state(), disabled: false, onControl: () => {}}));
    assert.match(html, /完成图片训练飞轮/);
    assert.match(html, /Dataset · 交付已验收/);
    assert.match(html, /已暂停/);
    assert.match(html, /继续固化任务/);
    assert.doesNotMatch(html, /暂停固化任务|生产验证通过/);
    const running = state();
    running.jobs.current.status = 'waiting_external';
    const waiting = renderToStaticMarkup(createElement(ConsolidationProgress, {state: running, disabled: false, onControl: () => {}}));
    assert.match(waiting, /等待外部任务或产物/);
    assert.match(waiting, /暂停固化任务/);
  } finally {
    await server.close();
  }
});
