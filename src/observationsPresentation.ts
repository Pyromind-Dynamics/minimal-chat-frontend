import type { MetricConfig, MetricPoint, ObservationOverview, StageAnalysis } from './observationsContract.ts';
import type { ExperimentExecution } from './experimentExecutions.ts';
import type { ConversationSnapshot } from './types.ts';

export function observationMessage(value: string | null | undefined): string {
  return value?.trim().replace(/[。．.]+$/u, '') ?? '';
}

export function matchesObservationReportVersions(expected: string[], received?: string[]): boolean {
  return !!received?.length && received.every(id => expected.includes(id));
}

export function observationHeadlineMetric(metrics?: NonNullable<StageAnalysis['result']>['metrics']) {
  return metrics?.find(metric => metric.label === 'result_accuracy') ?? metrics?.[0];
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
  if (['idle', 'pending', 'stopped', 'needs_input', ...Object.values(statusGroups).flat()].includes(status)) return status === 'succeeded' ? 'completed' : status;
  if (['terminated', 'cancelled', 'abandoned', 'rejected'].includes(status)) return 'stopped';
  if (['preparing', 'waiting_platform', 'submitting', 'analyzing', 'waiting_analysis', 'waiting_artifacts', 'agent_completed', 'cancel_requested'].includes(status)) return 'running';
  if (status === 'reported') return 'completed';
  return 'pending';
}
export function observationStageMessage(subject: string, status?: string): string {
  if (!status) return `正在读取${subject}状态`;
  if (status === 'pending' || status === 'idle') return `${subject}尚未开始`;
  if (status === 'paused') return `${subject}已暂停`;
  if (status === 'cancelled') return `${subject}已取消`;
  if (status === 'stopped') return `${subject}已停止`;
  if (status === 'needs_input') return `${subject}正在等待确认`;
  if (status === 'failed') return `${subject}执行失败`;
  const tone = observationStatusTone(status);
  if (tone === 'running') return `${subject}正在执行`;
  if (tone === 'success') return `${subject}已完成，暂无可展示的结果`;
  return `${subject}状态暂不可用`;
}

export function observationReportMessage(subject: string, businessStatus: string, reportStatus?: StageAnalysis['status']): string {
  if (reportStatus === 'queued') return '正在校验产物并生成报告';
  if (reportStatus === 'failed') return `${subject}已完成，报告生成失败`;
  if (reportStatus === 'ready') return '报告已生成，详情暂不可用';
  if (businessStatus === 'waiting_analysis') return `${subject}结果已返回，等待分析与交付`;
  const status = observationBusinessStatus(businessStatus);
  if (status === 'completed') return `${subject}已完成，等待产物版本登记`;
  return observationStageMessage(subject, businessStatus === 'cancelled' ? businessStatus : status);
}

export function observationNodeStatus(
  overview: ObservationOverview,
  node: ObservationOverview['nodes'][number],
  snapshot?: ConversationSnapshot | null,
): string {
  const status = node.business_status;
  if (status === 'succeeded' && node.delivery_status) {
    return node.delivery_status === 'failed' ? 'failed' : 'running';
  }
  const project = snapshot?.project;
  if (status !== 'running' || !project || project.project_id !== overview.project_id ||
      project.plan_sequence !== overview.plan_sequence || !node.current_run_ids.length) return status;

  const taskIds = new Set(project.plan.tasks?.filter(task => task.stage_id === node.id).map(task => task.id));
  if (!taskIds.size || taskIds.size !== node.current_run_ids.length) return status;

  const latestByTask = new Map<string, ExperimentExecution>();
  const attempt = (runId: string) => Number(runId.slice(runId.lastIndexOf(':') + 1));
  for (const run of snapshot?.experiment_executions ?? []) {
    if (run.project_id !== overview.project_id || run.plan_sequence !== overview.plan_sequence ||
        run.stage_id !== node.id || run.role_id !== 'main' || !taskIds.has(run.task_id)) continue;
    const previous = latestByTask.get(run.task_id);
    if (!previous || attempt(run.run_id) > attempt(previous.run_id)) latestByTask.set(run.task_id, run);
  }
  const runs = [...latestByTask.values()];
  if (runs.length !== taskIds.size || runs.some(run => !node.current_run_ids.includes(run.run_id))) return status;
  return runs.some(run => run.state === 'waiting_analysis') &&
    runs.every(run => run.state === 'waiting_analysis' || run.state === 'succeeded') ? 'waiting_analysis' : status;
}

export function observationEvidenceVersion(snapshot: ConversationSnapshot | null | undefined, projectId: string): string {
  if (snapshot?.project?.project_id !== projectId) return '';
  const runs = (snapshot.experiment_executions ?? []).filter(run => run.project_id === projectId && run.role_id === 'main');
  const tasks = (snapshot.external_tasks ?? []).map(task => [task.task_id, task.status]);
  return JSON.stringify([
    snapshot.project.plan_sequence,
    runs.map(run => [run.run_id, run.state, run.report_state, run.platform_task_id]),
    tasks,
    snapshot.stage_analyses?.map(job => [job.job_id, job.status]),
  ]);
}

export function trainingPanelBindings(overview: ObservationOverview | null, projectNodeId: string) {
  return overview?.bindings.filter(binding => binding.project_node_id === projectNodeId) ?? [];
}

export function formatTrainingMetric(value: number | null | undefined, metric: MetricConfig): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const key = metric.key.replace(/^(train|eval)[/_.]/, '');
  if (key === 'loss' && metric.unit === 'number') return value.toFixed(5);
  const display = metric.unit === 'ratio' ? value * 100 : value;
  const suffix = metricUnitSuffix(metric.unit);
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
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(display)}${metricUnitSuffix(unit)}`;
}

function metricUnitSuffix(unit: string): string {
  if (unit === 'ratio' || unit === 'percent') return '%';
  if (unit === 'seconds') return ' s';
  if (!unit || unit === 'number' || unit === 'count') return '';
  return ` ${unit}`;
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
