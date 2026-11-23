import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMetric, formatTrainingMetric, mergePoints, pointAxis, trainingCurvePath, observationStatusTone, observationBusinessStatus, observationResourceStatus, visibleTrainingPanels, trainingPanelBindings, observationProjectPhase, observationMessage, observationBaseline, observationStageStatus, observationEvidenceVersion, retainVerifiedModelReport } from '../src/observationsPresentation.ts';
import { candidateEvaluationSummary } from '../src/evaluationSummary.ts';
import { observationResourceMessage, observationStageMessage } from '../src/observationsPresentation.ts';
import type { ConversationSnapshot } from '../src/types.ts';
import type { ExperimentExecution } from '../src/experimentExecutions.ts';
import type { EvaluationRow, MetricPoint, ObservationOverview, RunBinding } from '../src/observationsContract.ts';

test('units are explicit and missing numeric values stay empty', () => {
  assert.equal(formatMetric(0.85, 'ratio'), '85%');
  assert.equal(formatMetric(85, 'percent'), '85%');
  assert.equal(formatMetric(2.5, 'seconds'), '2.5 s');
  assert.equal(formatMetric(0), '0');
  assert.equal(formatMetric(Number.NaN), '—');
  assert.equal(formatMetric(null), '—');
  assert.equal(observationMessage('请求失败。 '), '请求失败');
  assert.equal(observationMessage('Value 0.85.'), 'Value 0.85');
  assert.equal(observationMessage('https://example.com/run.json'), 'https://example.com/run.json');
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
test('checkpoint evaluation shows core results and selected step in one summary', () => {
  const row: EvaluationRow = { metric: { experiment_id: 'v1', version: 'v1', evaluation_run_id: 'e1', step_run_id: 's1', step: 9, role: 'checkpoint', dataset_role: 'validation', comparison_group: 'g1', metric: 'accuracy', value: .5, selected: true }, project_node_id: 'train', report_path: null, metrics_path: null, model_path: null, created_at: 1 };
  const summary = candidateEvaluationSummary(null, row, { samples: 2, eval_loss: .3, pass_rate: .8, macro_f1: .4, parse_rate: 1 });
  assert.equal(summary.primary?.key, 'accuracy');
  assert.deepEqual(summary.rows.map(m => [m.label, formatMetric(m.value, m.unit)]), [['准确率', '50%'], ['Macro-F1', '0.4'], ['JSON 解析率', '100%'], ['评估损失', '0.3'], ['评估样本', '2'], ['已选 Checkpoint', '9']]);
  assert.deepEqual(candidateEvaluationSummary(null, row).rows.map(m => m.key), ['accuracy', 'checkpoint']);
});

test('a standalone evaluation report shows known quality metrics and latency', () => {
  const report = { task_id: '1108', project_node_id: 'eval', run_id: 'r1', report_path: '/report.json', model_reference: 'model', metrics: { total: 20, passed: 13, failed: 7, mean_latency_seconds: 2, rubric_metrics: { json_parse_ok: { pass_rate: .9 } } }, observation_status: 'available' as const, message: null };
  const summary = candidateEvaluationSummary(report);
  assert.equal(summary.primary?.value, .65);
  assert.deepEqual(summary.rows.map(m => m.key), ['pass_rate', 'json_parse_rate', 'total', 'mean_latency_seconds']);
  assert.deepEqual(candidateEvaluationSummary({ ...report, observation_status: 'unavailable' }).rows, []);
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
  const resource = { kind: 'orchestrator' as const, observation_status: 'available' as const, state: 'dry-run', busy: false, runtime: null, message: null, observed_at: null };
  assert.equal(observationResourceStatus(resource), 'dry-run');
  assert.equal(observationResourceStatus({ ...resource, observation_status: 'unavailable' }), 'unavailable');
  assert.equal(observationResourceStatus({ ...resource, observation_status: 'forbidden' }), 'error');
});

const overviewFixture: ObservationOverview = {
  schema_version: 1, project_id: 'p', graph_id: 'g', lifecycle: 'frozen', frozen_execution_version: null,
  config_version: 'v', record_version: 'r', observed_at: '', nodes: [], resources: [], bindings: [], available_runs: [],
  config: { schema_version: 1, orchestrator_source_id: null, panels: ['SFT', 'GRPO'].map(training_type => ({ project_node_id: training_type.toLowerCase(), training_type, metrics: [], run_ids: [], platform_node_id: null })) },
};
const trainingBinding = (type: string, business_status = 'running'): RunBinding => ({ project_node_id: type.toLowerCase(), run_id: `run-${type}`, task_id: `task-${type}`, business_status, platform_node_id: null });
test('training panels follow actual project runs, never the two configured templates', () => {
  for (const algorithms of [[], ['SFT'], ['GRPO'], ['SFT', 'GRPO']]) {
    const overview = { ...overviewFixture, bindings: algorithms.map(type => trainingBinding(type)) };
    assert.deepEqual(visibleTrainingPanels(overview).map(panel => panel.training_type), algorithms);
  }
  assert.deepEqual(visibleTrainingPanels(null), []);
  assert.equal(visibleTrainingPanels({ ...overviewFixture, bindings: [trainingBinding('SFT', 'completed')] }).length, 1);
});
test('project phase follows execution evidence, independent of project freezing', () => {
  assert.equal(observationProjectPhase(overviewFixture), 'Not started');
  assert.equal(observationProjectPhase({ ...overviewFixture, lifecycle: 'development' }), 'Not started');
  assert.equal(observationProjectPhase({ ...overviewFixture, bindings: [trainingBinding('SFT')] }), 'Training');
  assert.equal(observationProjectPhase({ ...overviewFixture, bindings: [trainingBinding('SFT', 'completed')] }), 'Handoff');
  const snapshot = {
    project: { project_id: 'p', plan: { status: 'active', stages: [{ id: 'd', kind: 'dataset', name: 'Dataset' }, { id: 'sft', kind: 'train', name: 'SFT' }] } },
    experiment_executions: [{ project_id: 'p', stage_id: 'd', state: 'waiting_platform' }],
  } as ConversationSnapshot;
  assert.equal(observationProjectPhase(overviewFixture, snapshot), 'Dataset');
  assert.equal(observationProjectPhase(null, snapshot, 'p'), 'Dataset');
  assert.equal(observationProjectPhase(null, snapshot, 'other'), 'Not started');
  snapshot.experiment_executions!.push({ project_id: 'p', stage_id: 'sft', state: 'succeeded' } as ExperimentExecution);
  assert.equal(observationProjectPhase(overviewFixture, snapshot), 'Dataset'); // Parallel training completion must not hide active dataset work.
  snapshot.experiment_executions![0].state = 'preparing';
  assert.equal(observationBusinessStatus('preparing'), 'running');
  assert.equal(observationProjectPhase(overviewFixture, snapshot), 'Dataset');
  assert.equal(observationProjectPhase(overviewFixture, {
    ...snapshot, status: 'waiting_for_confirmation',
    pending_permissions: [{ permission_id: 'dataset-check', choices: ['allow_once', 'deny'], description: 'Continue dataset verification' }],
  }), 'Confirmation');
  snapshot.experiment_executions![0].state = 'succeeded';
  assert.equal(observationProjectPhase(overviewFixture, snapshot), 'Handoff');
  snapshot.project!.plan.status = 'completed';
  assert.equal(observationProjectPhase(overviewFixture, snapshot), 'Completed');
  snapshot.project!.plan.status = 'active';
  const delivered = { ...overviewFixture, delivery_complete: true };
  assert.equal(observationProjectPhase(delivered, snapshot), 'Completed');
  snapshot.experiment_executions![0].state = 'waiting_platform';
  assert.equal(observationProjectPhase(delivered, snapshot), 'Dataset');
  snapshot.experiment_executions = [{ project_id: 'p', stage_id: 'sft', state: 'prepared' } as ExperimentExecution];
  assert.equal(observationProjectPhase(overviewFixture, snapshot), 'Not started');
  snapshot.experiment_executions![0].state = 'waiting_user';
  assert.equal(observationProjectPhase(overviewFixture, snapshot), 'Confirmation');
  snapshot.experiment_executions![0].state = 'cancelled';
  assert.equal(observationProjectPhase(overviewFixture, snapshot), 'Stopped');
  snapshot.project!.project_id = 'other-project';
  assert.equal(observationProjectPhase(overviewFixture, snapshot), 'Not started');
});

test('Orchestrator baseline uses only this project baseline stages', () => {
  const snapshot = { project: { project_id: 'p', plan: { stages: [{ id: 'base', kind: 'init' }, { id: 'train', kind: 'train' }] } },
    experiment_executions: [{ project_id: 'p', stage_id: 'base', state: 'waiting_platform', run_id: 'baseline' }, { project_id: 'p', stage_id: 'train', state: 'preparing', run_id: 'training' }] } as ConversationSnapshot;
  assert.equal(observationBaseline(snapshot, 'p')?.run_id, 'baseline');
  assert.equal(observationBaseline(snapshot, 'other'), undefined);
  snapshot.experiment_executions![0].state = 'prepared';
  assert.equal(observationBaseline(snapshot, 'p'), undefined);
});

test('an unsubmitted baseline retry cannot hide its previously verified report', () => {
  const snapshot = {
    project: { project_id: 'p', plan: { stages: [{ id: 'base', kind: 'init' }] } },
    experiment_executions: [
      { project_id: 'p', stage_id: 'base', state: 'reported', run_id: 'good', platform_task_id: '1139' },
      { project_id: 'p', stage_id: 'base', state: 'failed', run_id: 'retry' },
    ],
  } as ConversationSnapshot;
  assert.equal(observationBaseline(snapshot, 'p')?.run_id, 'good');
  snapshot.experiment_executions![1].state = 'preparing';
  assert.equal(observationBaseline(snapshot, 'p')?.run_id, 'retry');
  snapshot.experiment_executions![1].state = 'failed';
  snapshot.experiment_executions![1].platform_task_id = '1141';
  assert.equal(observationBaseline(snapshot, 'p')?.run_id, 'retry');
});


test('live stage facts override an idle overview without waiting for the poll', () => {
  const overview = { project_id: 'p', nodes: [{ id: 'data', type: 'dataset', business_status: 'idle' }, { id: 'train', type: 'train', business_status: 'idle' }] } as ObservationOverview;
  const snapshot = { project: { project_id: 'p', plan: { stages: [{ id: 'data', kind: 'dataset' }, { id: 'train', kind: 'train' }] } }, experiment_executions: [{ project_id: 'p', stage_id: 'data', run_id: 'data-run', state: 'preparing' }, { project_id: 'p', stage_id: 'train', run_id: 'train-run', state: 'paused' }] } as ConversationSnapshot;
  assert.equal(observationStageStatus(overview, snapshot, 'p', 'dataset'), 'running');
  assert.equal(observationStageStatus(overview, snapshot, 'p', 'train'), 'paused');
  assert.equal(observationStageStatus(overview, snapshot, 'other', 'train'), 'pending');
  snapshot.experiment_executions![0].state = 'reported';
  assert.equal(observationStageStatus(overview, snapshot, 'p', 'dataset'), 'completed');
  snapshot.experiment_executions![0].run_id = 'subagent:data-run';
  assert.equal(observationStageStatus(overview, snapshot, 'p', 'dataset'), 'running');
  overview.nodes[0].execution_id = 'subagent:data-run';
  overview.nodes[0].business_status = 'completed';
  assert.equal(observationStageStatus(overview, snapshot, 'p', 'dataset'), 'completed');
});

test('Train shows failed delivery after platform success even before the overview refreshes', () => {
  const overview = {
    ...overviewFixture,
    nodes: [{ id: 'train', title: 'Train', type: 'train', business_status: 'waiting_analysis', execution_id: 'subagent:train' }],
  };
  const snapshot = {
    project: { project_id: 'p', plan: { stages: [{ id: 'train', kind: 'train' }] } },
    experiment_executions: [{ project_id: 'p', stage_id: 'train', run_id: 'subagent:train', platform_task_id: '1211', state: 'failed' }],
    external_tasks: [{ task_id: '1211', status: 'succeeded' }],
  } as ConversationSnapshot;
  assert.equal(observationStageStatus(overview, snapshot, 'p', 'train'), 'failed');
  snapshot.external_tasks![0].status = 'running';
  assert.equal(observationStageStatus(overview, snapshot, 'p', 'train'), 'running');
  snapshot.external_tasks![0].status = 'succeeded';
  snapshot.experiment_executions![0].state = 'agent_completed';
  assert.equal(observationStageStatus(overview, snapshot, 'p', 'train'), 'running');
});

test('Dataset detail statuses stay scoped to the selected node', () => {
  const overview = {
    ...overviewFixture,
    nodes: [
      { id: 'first', title: 'First', type: 'dataset', business_status: 'completed' },
      { id: 'second', title: 'Second', type: 'dataset', business_status: 'idle' },
    ],
  };
  const snapshot = {
    project: { project_id: 'p', plan: { stages: overview.nodes.map(node => ({ id: node.id, kind: 'dataset' })) } },
    experiment_executions: [{ project_id: 'p', stage_id: 'second', state: 'preparing' }],
  } as ConversationSnapshot;
  assert.equal(observationStageStatus(overview, snapshot, 'p', 'dataset'), 'running');
  assert.equal(observationStageStatus(overview, snapshot, 'p', 'dataset', 'first'), 'completed');
  assert.equal(observationStageStatus(overview, snapshot, 'p', 'dataset', 'second'), 'running');
});

test('sidebar messages distinguish stage outcomes and resource availability', () => {
  assert.equal(observationStageMessage('train', 'paused'), '训练已暂停');
  assert.equal(observationStageMessage('eval', 'failed'), '评估失败，暂无可展示的评估指标');
  assert.equal(observationStageMessage('baseline', 'pending'), '基线评估等待开始');
  assert.equal(observationStageMessage('dataset'), '正在读取数据准备状态');
  const resource = { kind: 'tracer' as const, observation_status: 'available' as const, state: 'serving', busy: false, runtime: null, message: null, observed_at: null };
  assert.equal(observationResourceMessage('tracer', resource), '采集资源运行中');
  assert.equal(observationResourceMessage('tracer', { ...resource, observation_status: 'unavailable' }), '采集资源暂不可用');
  assert.equal(observationResourceMessage('tracer', { ...resource, observation_status: 'forbidden' }), '采集资源需要授权后才能查看');
  assert.equal(observationResourceMessage('tracer', { ...resource, observation_status: 'not_configured' }), '未绑定采集资源');
});

test('report delivery and plan writes invalidate observations, chat streaming does not', () => {
  const snapshot = { project: { project_id: 'p', plan: { stages: [] } }, timeline: [], experiment_executions: [{ project_id: 'p', stage_id: 'data', run_id: 'r', state: 'preparing' }] } as unknown as ConversationSnapshot;
  const initial = observationEvidenceVersion(snapshot, 'p');
  snapshot.timeline.push({ kind: 'message', item_id: 'text', started_seq: 1, role: 'assistant', status: 'streaming', content: [{ type: 'text', text: 'working' }] });
  assert.equal(observationEvidenceVersion(snapshot, 'p'), initial);
  snapshot.experiment_executions![0].state = 'reported';
  const delivered = observationEvidenceVersion(snapshot, 'p');
  assert.notEqual(delivered, initial);
  snapshot.timeline.push({ kind: 'operation', item_id: 'plan-write', started_seq: 2, name: 'edit', category: 'tool', status: 'completed', arguments: { path: 'public_data/workflowPLAN.json' }, output: [], thought: [], details: null });
  assert.notEqual(observationEvidenceVersion(snapshot, 'p'), delivered);
  assert.equal(observationEvidenceVersion(snapshot, 'other'), '');
});

test('platform status events refresh the overview and only matching Dataset details', () => {
  const snapshot = {
    project: { project_id: 'p', plan_sequence: 1, plan: { status: 'active', stages: [] } },
    status: 'running',
    active_run_id: 'manager',
    experiment_executions: [
      { project_id: 'p', stage_id: 'dataset', run_id: 'd', platform_task_ids: ['data-task'], state: 'waiting_platform' },
      { project_id: 'p', stage_id: 'train', run_id: 't', platform_task_id: 'train-task', state: 'waiting_platform' },
    ],
    external_tasks: [{ task_id: 'data-task', status: 'running' }, { task_id: 'train-task', status: 'running' }],
  } as unknown as ConversationSnapshot;
  const overview = () => observationEvidenceVersion(snapshot, 'p');
  const dataset = () => observationEvidenceVersion(snapshot, 'p', 'dataset');
  const original = [overview(), dataset()];
  const [data, train] = snapshot.external_tasks!;
  train.status = 'succeeded';
  assert.notEqual(overview(), original[0]);
  assert.equal(dataset(), original[1]);
  data.status = 'succeeded';
  assert.notEqual(dataset(), original[1]);
  const beforeIdle = [overview(), dataset()];
  snapshot.status = 'idle';
  snapshot.active_run_id = null;
  assert.notEqual(overview(), beforeIdle[0]);
  assert.equal(dataset(), beforeIdle[1]);
});

test('Eval keeps an unregistered child in progress until the overview verifies that execution', () => {
  const overview = { project_id: 'p', nodes: [{ id: 'score', type: 'evaluator', business_status: 'completed', execution_id: 'earlier' }] } as ObservationOverview;
  const snapshot = { project: { project_id: 'p', plan: { stages: [{ id: 'score', kind: 'eval' }] } }, experiment_executions: [{ project_id: 'p', stage_id: 'score', run_id: 'eval-run', state: 'preparing' }] } as ConversationSnapshot;
  for (const [state, expected] of [['preparing', 'running'], ['waiting_platform', 'running'], ['failed', 'failed'], ['reported', 'running']]) {
    snapshot.experiment_executions![0].state = state as ExperimentExecution['state'];
    assert.equal(observationStageStatus(overview, snapshot, 'p', 'eval'), expected);
  }
  overview.nodes[0].execution_id = 'eval-run';
  assert.equal(observationStageStatus(overview, snapshot, 'p', 'eval'), 'completed');
  assert.equal(observationStageStatus(overview, snapshot, 'other', 'eval'), 'pending');
  assert.equal(observationStageStatus(overview, null, 'p', 'eval'), 'completed');
});

test('temporary Storage reads retain only the verified report for the same task', () => {
  const verified = {
    task_id: '1146', project_node_id: 'init', run_id: 'r1', report_path: '/report.json',
    model_reference: 'model', metrics: { accuracy: .5 }, observation_status: 'available' as const, message: null,
  };
  const unavailable = { ...verified, run_id: null, metrics: {}, observation_status: 'unavailable' as const };
  assert.equal(retainVerifiedModelReport(verified, unavailable), verified);
  const newTask = { ...unavailable, task_id: '1148' };
  assert.equal(retainVerifiedModelReport(verified, newTask), newTask);
  assert.equal(retainVerifiedModelReport(verified, null), null);
});

test('platform Evaluation requires a report tied to its task and stage', () => {
  const overview = { project_id: 'p', nodes: [], evaluation: { task_id: '1108', project_node_id: 'eval', observation_status: 'available' } } as unknown as ObservationOverview;
  const snapshot = { project: { project_id: 'p', plan: { stages: [{ id: 'eval', kind: 'eval' }] } }, experiment_executions: [{ project_id: 'p', stage_id: 'eval', state: 'analyzing', platform_task_id: '1108' }], external_tasks: [{ task_id: '1108', status: 'succeeded' }] } as unknown as ConversationSnapshot;
  assert.equal(observationStageStatus(overview, snapshot, 'p', 'eval'), 'running');
  assert.equal(observationStageStatus(null, snapshot, 'p', 'eval'), 'running');
  snapshot.experiment_executions![0].state = 'reported';
  assert.equal(observationStageStatus(null, snapshot, 'p', 'eval'), 'pending');
  assert.equal(observationStageStatus(overview, snapshot, 'p', 'eval'), 'completed');
  snapshot.experiment_executions![0].state = 'failed';
  snapshot.experiment_executions!.push({project_id: 'p', stage_id: 'eval', state: 'agent_completed'} as ExperimentExecution);
  assert.equal(observationStageStatus(overview, snapshot, 'p', 'eval'), 'running');
  snapshot.experiment_executions!.at(-1)!.state = 'preparing';
  assert.equal(observationStageStatus(overview, snapshot, 'p', 'eval'), 'running');
  snapshot.experiment_executions!.pop();
  snapshot.experiment_executions![0].state = 'reported';
  overview.evaluation!.task_id = 'other';
  assert.equal(observationStageStatus(overview, snapshot, 'p', 'eval'), 'running');
  overview.evaluation!.task_id = '1108';
  snapshot.external_tasks![0].status = 'pending';
  assert.equal(observationStageStatus(overview, snapshot, 'p', 'eval'), 'running');
  snapshot.external_tasks![0].status = 'failed';
  assert.equal(observationStageStatus(null, snapshot, 'p', 'eval'), 'failed');
});


test('custom algorithms and sparse training metrics keep their configured presentation', () => {
  const names = ['DPO', 'PPO', 'Audio fine-tuning', 'Custom training'];
  const overview = { ...overviewFixture, config: { ...overviewFixture.config, panels: names.map(training_type => ({ project_node_id: training_type, training_type, metrics: [], run_ids: [], platform_node_id: null })) }, bindings: names.map(name => ({ ...trainingBinding(name), project_node_id: name })) };
  assert.deepEqual(visibleTrainingPanels(overview).map(panel => panel.training_type), names);
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



test('keeps both project node bindings when a workflow runs two training nodes', () => {
  const sft = { ...trainingBinding('SFT'), run_id: 'same-run', platform_node_id: '10' };
  const grpo = { ...trainingBinding('GRPO'), run_id: 'same-run', platform_node_id: '20' };
  const overview = { bindings: [sft, grpo] } as ObservationOverview;
  assert.deepEqual(trainingPanelBindings(overview, 'sft'), [sft]);
  assert.deepEqual(trainingPanelBindings(overview, 'grpo'), [grpo]);
});
