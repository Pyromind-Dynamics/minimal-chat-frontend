import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { layoutPlan, planDiff, type WorkflowPlan } from '../src/experimentPlans.ts';

const plan: WorkflowPlan = {
  schema_version: 1, name: '图片质检实验', goal: '比较漏检与误检', resources: [], unresolved: ['训练参数待补充'],
  stages: [
    ...['Init', 'Data', 'Train', 'Eval'].map(name => ({ id: name.toLowerCase(), name, description: `${name} 阶段`, enabled: true, placeholder: false })),
    ...['Inference', 'Tracer'].map(name => ({ id: name.toLowerCase(), name, description: '', enabled: false, placeholder: true })),
  ],
  edges: [{ source: 'init', target: 'data' }, { source: 'data', target: 'train' }, { source: 'train', target: 'eval' }],
  tasks: [{ id: 'baseline', stage_id: 'init', name: '基模自由命名评测', description: '固定评测口径', inputs: [], outputs: [{ name: 'report', description: '预期基线报告' }], completion_conditions: [] }],
};

test('graph layout follows actual edges, including branches, and places placeholders separately', () => {
  const { nodes } = layoutPlan(plan);
  const node = (id: string) => nodes.find(stage => stage.id === id)!;
  assert.ok(node('init').y < node('data').y);
  assert.ok(node('data').y < node('train').y);
  assert.ok(node('eval').y < node('inference').y);
  const branched = layoutPlan({ ...plan, edges: [{ source: 'init', target: 'data' }, { source: 'init', target: 'train' }] });
  assert.equal(branched.nodes.find(stage => stage.id === 'data')!.y, branched.nodes.find(stage => stage.id === 'train')!.y);
});

test('proposal differences include task parameters and removed connections', () => {
  const after = { ...plan, goal: '只做评测', edges: [], tasks: plan.tasks.map(task => ({ ...task, description: '改用另一套评测口径' })) };
  const rows = planDiff(plan, after);
  assert.equal(rows.find(row => row.label === '实验目标')?.after, '只做评测');
  assert.ok(rows.find(row => row.label.startsWith('任务'))?.after.includes('改用另一套评测口径'));
  assert.equal(rows.find(row => row.label === '阶段连线')?.after, '无');
});

test('draft, confirmed, revision and historical views render real plan data and confirmation controls', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  try {
    const { ExperimentPlanPanel } = await server.ssrLoadModule('/src/components/ExperimentPlanPanel.tsx');
    const proposal = { proposal_id: 'proposal', base_revision: 0, plan, summary: '初始提案', changes: ['创建实验计划'], status: 'pending', created_at: '2026-10-29T00:00:00Z' };
    const view = { project_id: null, current_revision: 0, current: null, pending_proposal: proposal, history: [] };
    const props = { view, selectedRevision: null, busy: false, onDecision: () => {}, onHistory: () => {}, onRefresh: () => {} };
    const draft = renderToStaticMarkup(createElement(ExperimentPlanPanel, props));
    assert.ok(draft.includes('确认创建项目和计划'));
    assert.ok(draft.includes('<title>Init → Data</title>'));
    assert.ok(draft.includes('基模自由命名评测'));
    assert.ok(draft.includes('训练参数待补充'));
    assert.ok(draft.includes('占位 · 未启用'));
    assert.ok(!draft.includes('Run shell'));
    const revision = { project_id: 'project', revision: 1, plan, confirmed_by: '42', confirmed_at: '2026-10-29T00:00:00Z' };
    const confirmed = { ...view, project_id: 'project', current_revision: 1, current: revision, pending_proposal: null, history: [{ revision: 1, name: plan.name, confirmed_at: revision.confirmed_at }] };
    const saved = renderToStaticMarkup(createElement(ExperimentPlanPanel, { ...props, view: confirmed }));
    assert.ok(saved.includes('当前版本 1'));
    assert.ok(!saved.includes('确认创建项目和计划'));
    const modified = { ...confirmed, pending_proposal: { ...proposal, base_revision: 1, plan: { ...plan, goal: '只做评测' } } };
    const proposed = renderToStaticMarkup(createElement(ExperimentPlanPanel, { ...props, view: modified }));
    assert.ok(proposed.includes('相对当前版本的变化'));
    assert.ok(proposed.includes('确认保存新版本'));
    const history = renderToStaticMarkup(createElement(ExperimentPlanPanel, { ...props, view: modified, selectedRevision: revision }));
    assert.ok(history.includes('历史版本 1'));
    assert.ok(!history.includes('确认保存新版本'));
  } finally { await server.close(); }
});
