import type { ModelEvaluationObservation } from '../../observationsContract';
import { evaluationSummaryMetrics, type EvaluationSummaryMetric } from '../../evaluationSummary';
import { formatMetric, observationMessage } from '../../observationsPresentation';

export function EvaluationMetricTable({ rows, label }: { rows: EvaluationSummaryMetric[]; label: string }) {
  return <div className="baseline-metrics observation-summary-table"><table className="baseline-metrics-table" aria-label={label}>
    <thead><tr><th scope="col">评估指标</th><th scope="col">结果</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.key}><th scope="row" title={row.key === 'pass_rate' || row.key === 'failure_rate' ? '按评估用例统计，不是模型预测类别的占比' : undefined}>{row.label}</th><td title={row.detail}>{formatMetric(row.value, row.unit)}</td></tr>)}</tbody>
  </table></div>;
}

export function EvaluationSummaryPanel({ report, prefix = '基线' }: { report?: ModelEvaluationObservation | null; prefix?: string }) {
  if (!report) return null;
  if (report.observation_status !== 'available') return <p className="observation-error" role="alert">{observationMessage(report.message) || `${prefix}报告暂不可用`}</p>;
  const metrics = evaluationSummaryMetrics(report.metrics, prefix);
  return <>
    {metrics.summary.length > 0 ? <EvaluationMetricTable rows={metrics.summary} label={`${prefix}评估指标`} /> : <p className="rsi-detail-help">报告未提供汇总指标</p>}
    {metrics.additional.length > 0 && <details className="baseline-additional"><summary>其他报告指标</summary><EvaluationMetricTable rows={metrics.additional} label={`其他${prefix}评估指标`} /></details>}
  </>;
}
