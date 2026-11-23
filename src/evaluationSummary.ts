import type { EvaluationRow, ModelEvaluationObservation } from './observationsContract';

export interface EvaluationSummaryMetric {
  key: string; label: string; value: number; unit: 'number' | 'ratio' | 'seconds'; detail?: string;
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = (value: unknown): value is number => numeric(value) && Number.isInteger(value);
const ratio = (value: unknown): value is number => numeric(value) && value <= 1;

export function evaluationSummaryMetrics(metrics: Record<string, unknown>, prefix = '基线'): { summary: EvaluationSummaryMetric[]; additional: EvaluationSummaryMetric[] } {
  const summary: EvaluationSummaryMetric[] = [];
  const total = count(metrics.total) ? metrics.total : null;
  if (total !== null) summary.push({ key: 'total', label: '评估样本', value: total, unit: 'number' });
  for (const [key, label, field] of [['pass_rate', `${prefix}通过率`, 'passed'], ['failure_rate', `${prefix}未通过率`, 'failed']]) {
    const amount = metrics[field];
    if (count(amount) && (total === null || amount <= total)) summary.push({ key: field, label: field === 'passed' ? '通过样本' : '未通过样本', value: amount, unit: 'number' });
    if (total !== null && total > 0 && count(amount) && amount <= total) {
      summary.push({ key, label, value: amount / total, unit: 'ratio', detail: `${amount.toLocaleString()} / ${total.toLocaleString()}` });
    } else if (key === 'pass_rate' && total !== 0 && ratio(metrics.pass_rate)) {
      summary.push({ key, label, value: metrics.pass_rate, unit: 'ratio' });
    }
  }
  if (count(metrics.api_or_evaluation_errors)) summary.push({ key: 'api_or_evaluation_errors', label: '调用或评估错误', value: metrics.api_or_evaluation_errors, unit: 'number' });
  if (numeric(metrics.mean_latency_seconds)) summary.push({ key: 'mean_latency_seconds', label: '平均时延', value: metrics.mean_latency_seconds, unit: 'seconds' });
  const additional: EvaluationSummaryMetric[] = [];
  const labels: Record<string, string> = { json_parse_ok: 'JSON 解析', output_schema_fields: '输出字段', reason_present: '理由完整', result_correct: '结果判定' };
  for (const [name, value] of Object.entries(object(metrics.rubric_metrics)).slice(0, 32)) {
    const rubric = object(value);
    const title = labels[name] ?? name;
    if (ratio(rubric.pass_rate)) additional.push({ key: `${name}.pass_rate`, label: `${title}通过率`, value: rubric.pass_rate, unit: 'ratio' });
    const classification = object(rubric.classification);
    for (const [key, label] of [['accuracy', '准确率'], ['macro_f1', 'Macro-F1']]) {
      const result = classification[key];
      if (ratio(result)) additional.push({ key: `${name}.${key}`, label: `${title} ${label}`, value: result, unit: key === 'macro_f1' ? 'number' : 'ratio' });
    }
  }
  return { summary, additional };
}

export function candidateEvaluationSummary(
  report: ModelEvaluationObservation | null,
  checkpoint?: EvaluationRow | null,
  checkpointMetrics: Record<string, number> = {},
) {
  if (report) {
    if (report.observation_status !== 'available') return { primary: undefined, rows: [] };
    const { summary, additional } = evaluationSummaryMetrics(report.metrics, '候选');
    const accuracy = report.metrics.accuracy ?? additional.find(metric => metric.key === 'result_correct.accuracy')?.value;
    const primary: EvaluationSummaryMetric | undefined = summary.find(metric => metric.key === 'pass_rate')
      ?? (ratio(accuracy)
        ? { key: 'accuracy', label: '准确率', value: accuracy, unit: 'ratio' }
        : undefined);
    const samples = summary.find(metric => metric.key === 'total');
    const details = evaluationQualityDetails({
      macro_f1: report.metrics.macro_f1 ?? additional.find(metric => metric.key === 'result_correct.macro_f1')?.value,
      json_parse_rate: report.metrics.json_parse_rate ?? additional.find(metric => metric.key === 'json_parse_ok.pass_rate')?.value,
    });
    const latency = summary.find(metric => metric.key === 'mean_latency_seconds');
    return { primary, rows: [primary, ...details, samples, latency].filter(metric => metric !== undefined) };
  }
  if (!checkpoint) return { primary: undefined, rows: [] };

  const selected = checkpoint.metric;
  const metrics = { ...checkpointMetrics, [selected.metric]: selected.value };
  const qualityMetrics = [
    { key: 'accuracy', label: '准确率', unit: 'ratio' },
    { key: 'pass_rate', label: '候选通过率', unit: 'ratio' },
    { key: 'macro_f1', label: 'Macro-F1', unit: 'number' },
    { key: 'eval_loss', label: 'Eval loss', unit: 'number' },
  ] as const;
  const first = qualityMetrics.find(metric => metric.unit === 'ratio' ? ratio(metrics[metric.key]) : numeric(metrics[metric.key]));
  let primary: EvaluationSummaryMetric | undefined;
  if (first) {
    primary = { ...first, value: metrics[first.key] };
  } else if (!['samples', 'total', 'hits', 'n_result_match'].includes(selected.metric)) {
    primary = { key: selected.metric, label: selected.metric, value: selected.value, unit: 'number' };
  }
  const samples = metrics.samples ?? metrics.total;
  const rows: EvaluationSummaryMetric[] = primary ? [primary] : [];
  rows.push(...evaluationQualityDetails(metrics).filter(metric => metric.key !== primary?.key));
  if (count(samples)) rows.push({ key: 'total', label: '评估样本', value: samples, unit: 'number' });
  rows.push({ key: 'checkpoint', label: selected.selected ? '已选 Checkpoint' : '候选 Checkpoint', value: selected.step, unit: 'number' });
  return { primary, rows };
}

function evaluationQualityDetails(metrics: Record<string, unknown>): EvaluationSummaryMetric[] {
  const rows: EvaluationSummaryMetric[] = [];
  const parseRate = [metrics.json_parse_rate, metrics.json_parsable_rate, metrics.parse_rate].find(ratio);
  if (ratio(metrics.macro_f1)) rows.push({ key: 'macro_f1', label: 'Macro-F1', value: metrics.macro_f1, unit: 'number' });
  if (parseRate !== undefined) rows.push({ key: 'json_parse_rate', label: 'JSON 解析率', value: parseRate, unit: 'ratio' });
  if (numeric(metrics.eval_loss)) rows.push({ key: 'eval_loss', label: '评估损失', value: metrics.eval_loss, unit: 'number' });
  return rows;
}

