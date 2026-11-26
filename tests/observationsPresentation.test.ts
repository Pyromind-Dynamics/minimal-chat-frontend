import assert from 'node:assert/strict';
import test from 'node:test';
import type { ObservationsConfig } from '../src/observationsContract.ts';
import { observationSections } from '../src/observationForms.ts';
import { formatMetric, formatTrainingMetric, matchesObservationReportVersions, mergePoints, pointAxis, trainingCurvePath, observationStatusTone, observationBusinessStatus, trainingPanelBindings, observationHeadlineMetric, observationMessage, observationStageMessage, observationReportMessage, observationNodeStatus } from '../src/observationsPresentation.ts';

test('detail forms use the published block order and tolerate an older or unsupported layout', () => {
  const config: ObservationsConfig = { schema_version: 1, panels: [], detail_forms: { schema_version: 1, forms: [
    { project_node_id: 'init-a', sections: [{ id: 'metrics-only', label: 'Configured details', selection: 'report_version',
      blocks: [{ type: 'metrics', source: 'report' }, { type: 'select', label: 'Evaluation version' }] }] },
  ] } };
  const details = (value: ObservationsConfig) => observationSections(value, 'init-a', 'init', 'Baseline', '基线评估');
  assert.equal(details(config)[0].label, 'Configured details');
  assert.deepEqual(details(config)[0].blocks.map(block => block.type), ['metrics', 'select']);
  const legacy = details({ schema_version: 1, panels: [] });
  assert.deepEqual(details({ ...config, detail_forms: { schema_version: 2, forms: [] } }), legacy);
  assert.deepEqual(legacy[0].blocks.map(block => block.type), ['select', 'status', 'metrics', 'findings', 'artifacts']);
  const [evaluation] = observationSections({ schema_version: 1, panels: [] }, 'eval-a', 'eval', 'Evaluation', '评估');
  assert.equal(evaluation.selection, 'analysis_version');
  assert.deepEqual(evaluation.blocks.map(block => block.type), ['select', 'status', 'metrics']);
});
import type { MetricPoint, ObservationOverview, RunBinding } from '../src/observationsContract.ts';
import type { ConversationSnapshot } from '../src/types.ts';

test('units are explicit and missing numeric values stay empty', () => {
  assert.equal(formatMetric(0.85, 'ratio'), '85%');
  assert.equal(formatMetric(85, 'percent'), '85%');
  assert.equal(formatMetric(2.5, 'seconds'), '2.5 s');
  assert.equal(formatMetric(390, 'count'), '390');
  assert.equal(formatMetric(2.5, 'tokens/s'), '2.5 tokens/s');
  assert.equal(formatMetric(0), '0');
  assert.equal(formatMetric(Number.NaN), '—');
  assert.equal(formatMetric(null), '—');
  assert.equal(observationMessage('请求失败。 '), '请求失败');
  assert.equal(observationMessage('Value 0.85.'), 'Value 0.85');
  assert.equal(observationMessage('https://example.com/run.json'), 'https://example.com/run.json');
});

test('a readable subset of the registered reports remains visible', () => {
  assert.equal(matchesObservationReportVersions(['v2', 'v3'], ['v3']), true);
  assert.equal(matchesObservationReportVersions(['v2', 'v3'], ['v3', 'v4']), false);
  assert.equal(matchesObservationReportVersions(['v2', 'v3'], []), false);
});

test('the Baseline headline shows accuracy independently of report order', () => {
  const samples = { label: 'evaluated_samples', value: 120, unit: 'count' };
  const resultAccuracy = { label: 'result_accuracy', value: 0.81, unit: 'ratio' };
  const labelAccuracy = { label: 'label_accuracy', value: 0.82, unit: 'ratio' };
  const accuracy = { label: 'accuracy', value: 0.8, unit: 'ratio' };
  assert.equal(observationHeadlineMetric('init', [samples, labelAccuracy]), labelAccuracy);
  assert.equal(observationHeadlineMetric('init', [samples, accuracy, labelAccuracy, resultAccuracy]), resultAccuracy);
  assert.equal(observationHeadlineMetric('init', [samples, accuracy]), accuracy);
  assert.equal(observationHeadlineMetric('init', [samples]), undefined);
  assert.equal(observationHeadlineMetric('eval', [samples]), samples);
});

test('sparse axes remain independent, and source identities deduplicate', () => {
  const point: MetricPoint = { key: 'loss', value: 2, unit: 'number', source_point_id: 'run:1:loss', source_run_id: 'run', log_step: 1, training_step: null, time: 1700000000 };
  const metric = { key: 'loss', title: 'Loss', unit: 'number' as const, axis: 'training_step' as const, axis_key: 'global_step' };
  assert.equal(pointAxis(point, metric), null);
  assert.equal(pointAxis(point, { ...metric, axis: 'time' }), 1700000000);
  assert.deepEqual(mergePoints([point], [{ ...point, value: 1 }]), [{ ...point, value: 1 }]);
  assert.equal(mergePoints([], Array.from({ length: 1001 }, (_, index) => ({ ...point, log_step: index, source_point_id: String(index) }))).length, 1000);
});
test('training curve connects samples smoothly without overshooting or dropping repeated steps', () => {
  assert.equal(trainingCurvePath([]), '');
  assert.equal(trainingCurvePath([{ x: 0, y: 5 }]), '');
  assert.equal(trainingCurvePath([
    { x: 0, y: 0 },
    { x: 3, y: 3 },
    { x: 6, y: 0 },
    { x: 6, y: 6 },
    { x: 9, y: 6 },
  ]), 'M0 0 C1 1, 2 3, 3 3 C4 3, 5 0, 6 0 L6 6 C7 6, 8 6, 9 6');
});
test('RSI status labels and color groups match the approved HTML', () => {
  for (const value of ['running', 'run', 'serving', 'feeding', 'active', 'busy']) assert.equal(observationStatusTone(value), 'running');
  for (const value of ['completed', 'succeeded', 'ready', 'healthy', 'ok', 'enabled']) assert.equal(observationStatusTone(value), 'success');
  for (const value of ['failed', 'error', 'unavailable', 'down', 'unhealthy']) assert.equal(observationStatusTone(value), 'error');
  for (const value of ['paused', 'stale', 'degraded', 'dry-run']) assert.equal(observationStatusTone(value), 'warning');
  for (const value of ['idle', 'pending', 'stopped']) assert.equal(observationStatusTone(value), 'neutral');
  assert.equal(observationBusinessStatus('succeeded'), 'completed');
  assert.equal(observationBusinessStatus('waiting_platform'), 'running');
  assert.equal(observationBusinessStatus('cancelled'), 'stopped');
  assert.equal(observationBusinessStatus('new_backend_state'), 'pending');
});
test('small and missing training values retain their configured units and precision', () => {
  const metric = { key: 'learning_rate', title: 'Learning rate', unit: 'number' as const, axis: 'log_step' as const, axis_key: null };
  assert.equal(formatTrainingMetric(0.00002, metric), '0.00002');
  assert.equal(formatTrainingMetric(0.000012345678901, metric), '1.235e-5');
  assert.equal(formatTrainingMetric(0.000000123456789, { ...metric, key: 'train/learning_rate' }), '1.235e-7');
  assert.equal(formatTrainingMetric(1e-7, metric), '1e-7');
  assert.equal(formatTrainingMetric(-1e-7, { ...metric, key: 'reward' }), '-1e-7');
  assert.equal(formatTrainingMetric(0, metric), '0');
  assert.equal(formatTrainingMetric(Number.NaN, metric), '—');
  assert.equal(formatTrainingMetric(1e-8, { ...metric, unit: 'ratio' }), '0.000001%');
  assert.equal(formatTrainingMetric(1.234567, { ...metric, key: 'eval_loss' }), '1.23457');
});

test('training bindings remain scoped to the selected stage', () => {
  const binding = (project_node_id: string, run_id: string): RunBinding =>
    ({ project_node_id, run_id, task_id: '123', business_status: 'running', platform_node_id: null });
  const first = binding('train-a', 'main:a:1');
  const retry = binding('train-a', 'main:a:2');
  const other = binding('train-b', 'main:b:1');
  const overview = { bindings: [first, retry, other] } as ObservationOverview;
  assert.deepEqual(trainingPanelBindings(overview, 'train-a'), [first, retry]);
  assert.deepEqual(trainingPanelBindings(overview, 'train-b'), [other]);
  assert.deepEqual(trainingPanelBindings(null, 'train-a'), []);
  assert.equal(observationStageMessage('数据准备', 'pending'), '数据准备尚未开始');
});

test('stage details distinguish business and report states in Chinese', () => {
  assert.equal(observationReportMessage('数据准备', 'queued'), '数据准备尚未开始');
  assert.equal(observationReportMessage('数据准备', 'running'), '数据准备正在执行');
  assert.equal(observationReportMessage('数据准备', 'needs_input'), '数据准备正在等待确认');
  assert.equal(observationReportMessage('数据准备', 'cancelled'), '数据准备已取消');
  assert.equal(observationReportMessage('数据准备', 'failed'), '数据准备执行失败');
  assert.equal(observationReportMessage('数据准备', 'succeeded'), '数据准备已完成，等待产物版本登记');
  assert.equal(observationReportMessage('数据准备', 'succeeded', 'queued'), '正在校验产物并生成报告');
  assert.equal(observationReportMessage('数据准备', 'succeeded', 'failed'), '数据准备已完成，报告生成失败');
  assert.equal(observationReportMessage('数据准备', 'succeeded', 'ready'), '报告已生成，详情暂不可用');
  assert.equal(observationReportMessage('基线评估', 'waiting_analysis'), '基线评估结果已返回，等待分析与交付');
});

test('the sidebar shows delivery waiting only for the current attempts of all stage tasks', () => {
  const node = { id: 'init', title: 'Init', type: 'init', business_status: 'running', current_run_ids: ['p:a:2', 'p:b:1'] };
  const overview = { project_id: 'p', plan_sequence: 4 } as ObservationOverview;
  const snapshot = {
    project: { project_id: 'p', plan_sequence: 4, plan: { tasks: [{ id: 'a', stage_id: 'init' }, { id: 'b', stage_id: 'init' }] } },
    experiment_executions: [
      { run_id: 'p:a:1', project_id: 'p', plan_sequence: 4, stage_id: 'init', role_id: 'main', task_id: 'a', state: 'failed' },
      { run_id: 'p:a:2', project_id: 'p', plan_sequence: 4, stage_id: 'init', role_id: 'main', task_id: 'a', state: 'waiting_analysis' },
      { run_id: 'p:b:1', project_id: 'p', plan_sequence: 4, stage_id: 'init', role_id: 'main', task_id: 'b', state: 'succeeded' },
    ],
  } as ConversationSnapshot;
  assert.equal(observationNodeStatus(overview, node, snapshot), 'waiting_analysis');
  assert.equal(observationNodeStatus(overview, { ...node, business_status: 'succeeded' }, snapshot), 'succeeded');
  assert.equal(observationNodeStatus(overview, {
    ...node, business_status: 'waiting_analysis', report_version_ids: ['v3'],
  }, snapshot), 'report_ready_pending_analysis');
  assert.equal(observationNodeStatus(overview, {
    ...node, business_status: 'waiting_analysis', delivery_status: 'pending',
  }, snapshot), 'waiting_delivery');
  assert.equal(observationNodeStatus(overview, { ...node, business_status: 'succeeded', delivery_status: 'registering' }, snapshot), 'running');
  assert.equal(observationNodeStatus(overview, { ...node, business_status: 'succeeded', delivery_status: 'failed' }, snapshot), 'failed');
  assert.equal(observationNodeStatus({ ...overview, plan_sequence: 3 }, node, snapshot), 'running');
  assert.equal(observationNodeStatus(overview, { ...node, current_run_ids: ['p:a:1', 'p:b:1'] }, snapshot), 'running');
  assert.equal(observationNodeStatus(overview, { ...node, current_run_ids: ['p:a:2'] }, snapshot), 'running');
  const runs = snapshot.experiment_executions!;
  const running = { ...runs[2], state: 'waiting_platform' };
  assert.equal(observationNodeStatus(overview, node, { ...snapshot, experiment_executions: [runs[0], runs[1], running] }), 'running');
  assert.equal(observationNodeStatus(overview, node, { ...snapshot, experiment_executions: [...runs, { ...running, run_id: 'p:b:2' }] }), 'running');
});
