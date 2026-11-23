import type { MetricConfig, MetricPoint, ModelEvaluationObservation, ObservationOverview, ObservationStatus, ResourceStatus } from './observationsContract.ts';
import type { ConversationSnapshot } from './types.ts';
import type { ExperimentExecution } from './experimentExecutions.ts';

export function observationMessage(value: string | null | undefined): string {
  return value?.trim().replace(/[。．.]+$/u, '') ?? '';
}

// The labels and tone groups follow the approved RSI HTML demo.
const statusGroups = {
  running: ['running', 'run', 'serving', 'feeding', 'active', 'busy'],
  success: ['completed', 'succeeded', 'ready', 'healthy', 'ok', 'enabled'],
  error: ['failed', 'error', 'unavailable', 'down', 'unhealthy'],
  warning: ['paused', 'stale', 'degraded', 'dry-run'],
};
export function observationStatusTone(status: string): string {
  return Object.entries(statusGroups).find(([, values]) => values.includes(status))?.[0] ?? 'neutral';
}
export function observationBusinessStatus(status?: string): string {
  if (!status) return 'pending';
  if (['idle', 'pending', 'stopped', ...Object.values(statusGroups).flat()].includes(status)) return status === 'succeeded' ? 'completed' : status;
  if (['terminated', 'cancelled', 'abandoned', 'rejected'].includes(status)) return 'stopped';
  if (['preparing', 'waiting_platform', 'submitting', 'analyzing', 'waiting_analysis', 'waiting_artifacts', 'agent_completed', 'cancel_requested'].includes(status)) return 'running';
  if (status === 'reported') return 'completed';
  return 'pending';
}
export function observationResourceStatus(resource?: ResourceStatus): string {
  if (!resource || resource.observation_status === 'not_configured') return 'pending';
  if (resource.observation_status === 'unavailable') return 'unavailable';
  if (resource.observation_status === 'forbidden') return 'error';
  return resource.busy ? 'busy' : resource.state ? observationBusinessStatus(resource.state) : 'idle';
}

type ObservationStage = 'dataset' | 'train' | 'eval' | 'baseline';
const stageNames: Record<ObservationStage, string> = {
  dataset: '数据准备', train: '训练', eval: '评估', baseline: '基线评估',
};
const stageMessages: Record<ObservationStage, { idle: string; running: string; completed: string; failed: string }> = {
  dataset: {
    idle: '尚未开始准备数据',
    running: '正在准备或登记数据集',
    completed: '数据准备已完成，暂无可展示的数据集文件',
    failed: '数据准备失败，暂无可展示的数据集文件',
  },
  train: {
    idle: '暂无训练运行',
    running: '训练流程进行中，等待平台任务或指标就绪',
    completed: '训练已完成，暂无可展示的训练指标',
    failed: '训练流程失败，暂无可展示的训练指标',
  },
  eval: {
    idle: '尚未开始评估',
    running: '评估流程进行中，结果将在登记后显示',
    completed: '评估已完成，暂无可展示的评估指标',
    failed: '评估失败，暂无可展示的评估指标',
  },
  baseline: {
    idle: '尚未开始基线评估',
    running: '基线评估流程进行中，报告将在登记后显示',
    completed: '基线评估已完成，暂无可展示的报告',
    failed: '基线评估失败，暂无可展示的报告',
  },
};
export function observationStageMessage(kind: ObservationStage, status?: string): string {
  const name = stageNames[kind];
  if (!status) return `正在读取${name}状态`;
  if (status === 'pending') return `${name}等待开始`;
  if (status === 'paused') return `${name}已暂停`;
  if (status === 'stopped') return `${name}已停止`;
  const tone = observationStatusTone(status);
  if (tone === 'running') return stageMessages[kind].running;
  if (tone === 'success') return stageMessages[kind].completed;
  if (status === 'failed') return stageMessages[kind].failed;
  if (tone === 'error' || status === 'stale') return `${name}信息暂不可用`;
  return stageMessages[kind].idle;
}

const resourceNames = { tracer: '采集资源', inference: '在线推理实例', orchestrator: '流程协调来源' };
export function observationResourceMessage(kind: ResourceStatus['kind'], resource?: ResourceStatus): string {
  const name = resourceNames[kind];
  if (!resource || resource.observation_status === 'not_configured') return `未绑定${name}`;
  if (resource.observation_status === 'forbidden') return `${name}需要授权后才能查看`;
  if (resource.observation_status === 'unavailable') return kind === 'orchestrator' && resource.runtime && resource.observed_at
    ? `${name}暂不可用，显示上次查询结果` : `${name}暂不可用`;
  const status = observationResourceStatus(resource);
  if (status === 'paused') return `${name}已暂停`;
  if (status === 'stopped') return `${name}已停止`;
  if (status === 'stale') return `${name}状态需要更新`;
  if (status === 'degraded') return `${name}运行受限`;
  if (status === 'dry-run') return `${name}正在试运行`;
  const tone = observationStatusTone(status);
  if (tone === 'error') return `${name}运行异常`;
  if (tone === 'running') return `${name}运行中`;
  if (tone === 'success') return `${name}可用`;
  return status === 'idle' ? `${name}空闲` : `${name}等待就绪`;
}
export function retainVerifiedModelReport(previous?: ModelEvaluationObservation | null, current?: ModelEvaluationObservation | null) {
  if (current?.observation_status === 'unavailable' && previous?.observation_status === 'available' &&
      current.project_node_id === previous.project_node_id && current.task_id === previous.task_id &&
      (!current.run_id || current.run_id === previous.run_id)) return previous;
  return current;
}
export function observationBaseline(snapshot: ConversationSnapshot | null | undefined, projectId: string) {
  return currentStageExecution(stageExecutions(snapshot, projectId, ['init', 'baseline']), true);
}
export function observationEvaluation(snapshot: ConversationSnapshot | null | undefined, projectId: string, taskId?: string) {
  const runs = stageExecutions(snapshot, projectId, ['evaluator', 'eval']);
  return taskId ? runs.findLast(run => platformTaskIds(run).includes(taskId)) : currentStageExecution(runs);
}
function platformTaskIds(run: ExperimentExecution): string[] {
  return [run.platform_task_id, ...(run.platform_task_ids ?? [])].filter((id): id is string => Boolean(id));
}
function stageExecutions(snapshot: ConversationSnapshot | null | undefined, projectId: string, kinds: string[], ids: string[] = []) {
  if (snapshot?.project?.project_id !== projectId) return [];
  const stages = new Set([...ids, ...snapshot.project.plan.stages.filter(stage => stage.enabled !== false && kinds.includes(stage.kind ?? stage.id)).map(stage => stage.id)]);
  return snapshot.experiment_executions?.filter(run => run.project_id === projectId && run.stage_id && stages.has(run.stage_id) && run.state !== 'prepared') ?? [];
}
function currentStageExecution(runs: ExperimentExecution[], preferPlatform = false) {
  const latest = runs.at(-1);
  if (!preferPlatform || !latest) return latest;
  return activeStageExecution(latest) ? latest : runs.findLast(run => platformTaskIds(run).length > 0) ?? latest;
}
function activeStageExecution(run: ExperimentExecution) {
  return (observationBusinessStatus(run.state) === 'running' && run.state !== 'agent_completed') ||
    ['queued', 'queued_submission', 'awaiting_confirmation', 'waiting_user', 'waiting_confirmation'].includes(run.state);
}
export function observationEvidenceVersion(snapshot: ConversationSnapshot | null | undefined, projectId: string, nodeId?: string): string {
  if (snapshot?.project?.project_id !== projectId) return '';
  const runs = (snapshot.experiment_executions ?? []).filter(run => run.project_id === projectId && (!nodeId || run.stage_id === nodeId));
  const taskIds = new Set(runs.flatMap(platformTaskIds));
  const tasks = (snapshot.external_tasks ?? [])
    .filter(task => !nodeId || taskIds.has(task.task_id))
    .map(task => [task.task_id, task.status]);
  const executions = runs.map(run => [run.run_id, run.state, run.report_state, run.report_uri, run.platform_task_id, run.platform_task_ids]);
  const write = snapshot.timeline?.findLast(item => item.kind === 'operation' && item.status === 'completed' && ['write', 'edit', 'terminal'].includes(item.name) && JSON.stringify(item.arguments)?.includes('workflowPLAN.json'));
  const canComplete = ['idle', 'finished'].includes(snapshot.status) && !snapshot.active_run_id &&
    !snapshot.pending_inputs?.length && !snapshot.pending_permissions?.length;
  const projectState = nodeId ? null : [snapshot.project.plan_sequence, snapshot.project.plan.status, canComplete];
  return JSON.stringify([executions, tasks, write?.started_seq, projectState]);
}
export function observationStageStatus(overview: ObservationOverview | null, snapshot: ConversationSnapshot | null | undefined, projectId: string, kind: 'dataset' | 'train' | 'eval', nodeId?: string): string {
  const nodeType = kind === 'eval' ? 'evaluator' : kind;
  const nodes = overview?.project_id === projectId ? overview.nodes.filter(node => node.type === nodeType && (!nodeId || node.id === nodeId)) : [];
  const runs = stageExecutions(snapshot, projectId, kind === 'eval' ? ['eval', 'evaluator'] : [kind], nodes.map(node => node.id))
    .filter(run => !nodeId || run.stage_id === nodeId);
  const byStage = new Map<string | null, ExperimentExecution[]>();
  for (const run of runs) {
    const stage = byStage.get(run.stage_id) ?? [];
    stage.push(run);
    byStage.set(run.stage_id, stage);
  }
  const selected = new Set([...byStage.values()].map(stageRuns => currentStageExecution(stageRuns, kind === 'train')));
  const displayed = runs.filter(run => selected.has(run));
  const run = displayed.findLast(activeStageExecution) ?? displayed.at(-1);
  if (!run) return observationBusinessStatus(nodes.at(-1)?.business_status);
  const stage = nodes.find(node => node.id === run.stage_id);
  const task = snapshot?.external_tasks?.find(item => item.task_id === run.platform_task_id);
  if (task?.status === 'failed') return 'failed';
  if (task && ['stopped', 'terminated'].includes(task.status)) return 'stopped';
  if (task && ['pending', 'running', 'waiting'].includes(task.status)) return 'running';
  if (kind === 'dataset' && run.state === 'reported' && run.run_id.startsWith('subagent:')) {
    if (overview?.project_id !== projectId) return 'pending';
    return stage?.execution_id === run.run_id && stage.business_status === 'completed' ? 'completed' : 'running';
  }
  if (kind === 'eval' && ['reported', 'agent_completed', 'analyzing', 'waiting_analysis'].includes(run.state)) {
    if (run.state === 'reported' && overview?.project_id !== projectId) return 'pending';
    const report = overview?.project_id === projectId ? overview.evaluation : null;
    if (run.state === 'reported' && report?.observation_status === 'available' && report.project_node_id === run.stage_id && platformTaskIds(run).includes(report.task_id)) return 'completed';
    if (!platformTaskIds(run).length && run.state === 'reported' && stage?.execution_id === run.run_id && stage?.business_status === 'completed') return 'completed';
    return 'running';
  }
  return observationBusinessStatus(run.state);
}
export function trainingPanelBindings(overview: ObservationOverview | null, projectNodeId: string) {
  return overview?.bindings.filter(binding => binding.project_node_id === projectNodeId) ?? [];
}

export function visibleTrainingPanels(overview: ObservationOverview | null) {
  return overview?.config.panels.filter(panel => overview.bindings.some(binding => binding.project_node_id === panel.project_node_id)) ?? [];
}

const phaseLabels: Record<string, string> = {
  empty: 'Not started', planning: 'Preparation', need_train_source: 'Awaiting data',
  project_review: 'Project review', tracing: 'Collection', tracer: 'Collection',
  dataset: 'Dataset', baseline: 'Baseline', confirmation: 'Confirmation',
  training: 'Training', train: 'Training', train_finished: 'Handoff',
  inference: 'Inference', evaluation: 'Evaluation', eval: 'Evaluation',
  complete: 'Completed', stopped: 'Stopped', init: 'Baseline',
};
export function observationProjectPhase(overview: ObservationOverview | null, snapshot?: ConversationSnapshot | null, projectId = overview?.project_id): string {
  const project = snapshot?.project?.project_id === projectId ? snapshot?.project : null;
  const runs = project ? (snapshot?.experiment_executions ?? []).filter(run => run.project_id === project.project_id && run.state !== 'prepared') : [];
  if (project && snapshot?.status === 'waiting_for_confirmation' &&
      (snapshot.pending_inputs?.length || snapshot.pending_permissions?.length)) return 'Confirmation';
  if (overview?.delivery_complete && overview.project_id === projectId && project && !snapshot?.active_run_id &&
      !snapshot?.pending_inputs?.length && !snapshot?.pending_permissions?.length &&
      !runs.some(activeStageExecution)) return 'Completed';
  // Prefer a live execution over a later completed parallel execution.
  const run = runs.findLast(item => ['running', 'pending'].includes(observationBusinessStatus(item.state))) ?? runs.at(-1);
  if (run) {
    if (observationBusinessStatus(run.state) === 'stopped') return 'Stopped';
    if (['awaiting_confirmation', 'waiting_user', 'waiting_confirmation'].includes(run.state)) return 'Confirmation';
    if (['queued', 'queued_submission', 'submitting'].includes(run.state)) return 'Preparation';
    if (project?.plan.status === 'completed' && runs.every(item => observationBusinessStatus(item.state) === 'completed')) return 'Completed';
    const stage = project?.plan.stages.find(item => item.id === run.stage_id) ?? run.stage_snapshot;
    const kind = stage?.kind ?? '';
    return kind === 'train' && observationBusinessStatus(run.state) === 'completed' ? 'Handoff' : phaseLabels[kind] ?? stage?.name ?? 'Preparation';
  }
  const orchestrator = overview?.resources.find(resource => resource.kind === 'orchestrator');
  if (orchestrator?.observation_status === 'available' && orchestrator.state && phaseLabels[orchestrator.state]) return phaseLabels[orchestrator.state];
  const binding = overview?.bindings.findLast(item => observationBusinessStatus(item.business_status) === 'running') ?? overview?.bindings.at(-1);
  if (binding) return observationBusinessStatus(binding.business_status) === 'stopped' ? 'Stopped' : observationBusinessStatus(binding.business_status) === 'completed' ? 'Handoff' : 'Training';
  return 'Not started';
}

export function formatTrainingMetric(value: number | null | undefined, metric: MetricConfig): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const key = metric.key.replace(/^(train|eval)[/_.]/, '');
  if (key === 'loss') return value.toFixed(5);
  const display = metric.unit === 'ratio' ? value * 100 : value;
  const suffix = metric.unit === 'ratio' || metric.unit === 'percent' ? '%' : metric.unit === 'seconds' ? ' s' : '';
  if (key === 'learning_rate') {
    const rounded = Number(display.toPrecision(4));
    const decimal = String(rounded);
    return `${decimal.length > 9 ? rounded.toExponential() : decimal}${suffix}`;
  }
  if (display !== 0 && Math.abs(display) < 0.0001) {
    return `${Number(display.toPrecision(6))}${suffix}`;
  }
  return formatMetric(value, metric.unit);
}

export function formatMetric(value: number | null | undefined, unit: string = 'number'): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const display = unit === 'ratio' ? value * 100 : value;
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(display)}${unit === 'ratio' || unit === 'percent' ? '%' : unit === 'seconds' ? ' s' : ''}`;
}
export function pointAxis(point: MetricPoint, metric: MetricConfig): number | null {
  return metric.axis === 'log_step' ? point.log_step : metric.axis === 'training_step' ? point.training_step : point.time;
}
export function trainingCurvePath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  const slopes = points.slice(1).map((point, index) => {
    const previous = points[index];
    return point.x === previous.x ? 0 : (point.y - previous.y) / (point.x - previous.x);
  });
  // Limit each tangent to the smaller adjacent slope to avoid overshooting either sample.
  const tangents = points.map((_, index) => {
    const before = slopes[index - 1] ?? slopes[index];
    const after = slopes[index] ?? before;
    return Math.sign(before) === Math.sign(after)
      ? Math.sign(before) * Math.min(Math.abs(before), Math.abs(after))
      : 0;
  });
  const segments = points.slice(1).map((point, index) => {
    const previous = points[index];
    const third = (point.x - previous.x) / 3;
    if (third === 0) return `L${point.x} ${point.y}`;
    return `C${previous.x + third} ${previous.y + tangents[index] * third}, ${point.x - third} ${point.y - tangents[index + 1] * third}, ${point.x} ${point.y}`;
  });
  return `M${points[0].x} ${points[0].y} ${segments.join(' ')}`;
}

export function mergePoints(previous: MetricPoint[], incoming: MetricPoint[], limit = 1000): MetricPoint[] {
  const points = new Map(previous.map(point => [point.source_point_id, point]));
  for (const point of incoming) points.set(point.source_point_id, point);
  return [...points.values()].sort((a, b) => a.log_step - b.log_step).slice(-limit);
}
export function statusLabel(status: ObservationStatus): string {
  return { available: '已接入', unavailable: '暂不可用', not_configured: '未配置', forbidden: '需要授权' }[status];
}
export function timestamp(value: string | null | undefined): string {
  if (!value) return '尚未取数';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '时间未知' : date.toLocaleString('zh-CN', { hour12: false });
}
