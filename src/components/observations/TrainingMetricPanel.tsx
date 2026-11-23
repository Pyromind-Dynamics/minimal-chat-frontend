import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { RequestOptions } from '../../api';
import type { ProductClient } from '../../productClient';
import type { MetricConfig, MetricPoint, PanelConfig, RunBinding } from '../../observationsContract';
import { formatTrainingMetric, pointAxis, trainingCurvePath, observationBusinessStatus, observationMessage, observationStageMessage } from '../../observationsPresentation';
import { useTrainingObservations } from '../../hooks/useProjectObservations';

function MetricChart({ metric, points }: { metric: MetricConfig; points: MetricPoint[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const tooltipId = useId();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipHeight, setTooltipHeight] = useState(56);
  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!tooltip) return;
    const measure = () => setTooltipHeight(tooltip.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tooltip);
    return () => observer.disconnect();
  }, [activeId, metric.key, points]);
  const data = points.filter(point => point.key === metric.key && Number.isFinite(point.value)).map(point => ({ point, x: pointAxis(point, metric) })).filter((item): item is { point: MetricPoint; x: number } => item.x != null && Number.isFinite(item.x)).sort((a, b) => a.x - b.x);
  const minX = Math.min(...data.map(item => item.x));
  const maxX = Math.max(...data.map(item => item.x));
  const minY = Math.min(...data.map(item => item.point.value));
  const maxY = Math.max(...data.map(item => item.point.value));
  const x = (value: number) => 82 + (maxX === minX ? 0.5 : (value - minX) / (maxX - minX)) * 324;
  const y = (value: number) => 150 - (maxY === minY ? 0.5 : (value - minY) / (maxY - minY)) * 128;
  const curve = trainingCurvePath(data.map(item => ({ x: x(item.x), y: y(item.point.value) })));
  const axisLabel = metric.axis === 'time' ? 'time' : metric.axis_key || 'step';
  const valueLabel = metric.key.replace(/^(train|eval)[/_.]/, '');
  const formatValue = (value: number | null | undefined) => formatTrainingMetric(value, metric);
  const active = data.find(item => item.point.source_point_id === activeId);
  return <section className="observation-metric" aria-label={metric.title}>
    <div className="observation-card-heading"><h4 title={metric.key}>{metric.title}</h4><strong>{formatValue(data.at(-1)?.point.value)}</strong></div>
    {data.length === 0 ? <p className="observation-empty">暂无历史数据{points.some(point => point.key === metric.key) ? '，来源缺少配置横轴' : ''}</p> : <>
      <div className="observation-chart" onPointerLeave={() => setActiveId(null)}>
      <svg viewBox="0 0 420 178" role="group" aria-label={`${metric.title}，${data.length} 个点，${axisLabel}`} onPointerMove={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const pointerX = (event.clientX - bounds.left) / bounds.width * 420;
        const nearest = data.reduce((best, item) => Math.abs(x(item.x) - pointerX) < Math.abs(x(best.x) - pointerX) ? item : best);
        setActiveId(nearest.point.source_point_id);
      }}>
        <path d="M82 16 V150 H410" fill="none" stroke="#cbd5e1" />
        <text x="70" y="22" textAnchor="end" dominantBaseline="middle" fill="#64748b">{formatValue(maxY)}</text><text x="70" y="150" textAnchor="end" dominantBaseline="middle" fill="#64748b">{formatValue(minY)}</text>
        {curve && <path d={curve} fill="none" stroke="#2563eb" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {active && <path d={`M${x(active.x)} 16 V150`} stroke="#94a3b8" strokeDasharray="3 3" fill="none" />}
        {data.map(({ point, x: value }) => <g key={point.source_point_id} tabIndex={0} role="button" aria-label={`${axisLabel}: ${value}, ${metric.title}: ${['loss', 'learning_rate'].includes(valueLabel) ? formatValue(point.value) : point.value}`} aria-describedby={activeId === point.source_point_id ? tooltipId : undefined} onFocus={() => setActiveId(point.source_point_id)} onBlur={() => setActiveId(null)} onClick={() => setActiveId(point.source_point_id)} onKeyDown={event => {
          if (event.key === 'Escape') setActiveId(null);
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActiveId(point.source_point_id); }
        }}>
          <rect x={x(value) - 11} y={y(point.value) - 11} width="22" height="22" fill="transparent" />
        </g>)}
        <text x="82" y="170" fill="#64748b">{minX}</text><text x="406" y="170" textAnchor="end" fill="#64748b">{maxX}</text>
      </svg>
      {active && <div ref={tooltipRef} id={tooltipId} role="tooltip" className="observation-chart-tooltip" style={{ ...(x(active.x) <= 210 ? { left: `calc(${x(active.x) / 420 * 100}% + 12px)` } : { right: `calc(${100 - x(active.x) / 420 * 100}% + 12px)` }), top: `clamp(${tooltipHeight / 2 + 8}px, ${y(active.point.value) / 178 * 100}%, calc(100% - ${tooltipHeight / 2 + 8}px))` }}>
        <dl><dt title={axisLabel}>{axisLabel}</dt><dd>{active.x}</dd><dt title={valueLabel}>{valueLabel}</dt><dd>{formatValue(active.point.value)}</dd></dl>
      </div>}
      </div>
      <p className="observation-chart-axis">{axisLabel}</p>
    </>}
  </section>;
}
export function TrainingMetricPanel({ client, projectId, panel, bindings, configVersion, options, reportedTaskIds }: { client: ProductClient; projectId: string; panel: PanelConfig; bindings: RunBinding[]; configVersion: string; options: RequestOptions; reportedTaskIds: string[] }) {
  const [selectedRun, setSelectedRun] = useState('');
  const runId = bindings.some(run => run.run_id === selectedRun) ? selectedRun : bindings.at(-1)?.run_id ?? '';
  const binding = bindings.find(run => run.run_id === runId);
  const metrics = binding?.metrics ?? panel.metrics;
  const trainingType = binding?.training_type ?? panel.training_type;
  const result = useTrainingObservations(client, projectId, panel.project_node_id, metrics, runId, configVersion, options, binding);
  const points = result?.points ?? [];
  const hasReport = binding && (binding.history_path || reportedTaskIds.includes(binding.task_id));
  const loading = Boolean(hasReport && metrics.length && !result);
  const status = binding ? observationBusinessStatus(binding.business_status) : 'idle';
  let placeholder = observationStageMessage('train', status);
  if (status === 'pending' || status === 'running') placeholder = '等待训练指标上报';
  if (status === 'failed') placeholder = '训练失败，暂无可展示的训练指标';
  if (loading) placeholder = '正在加载训练数据';
  if (result?.page.observation_status === 'unavailable') placeholder = '训练指标暂不可用';
  if (result?.page.observation_status === 'forbidden') placeholder = '训练指标需要授权后才能查看';
  return <section className="observation-card" aria-label={`${trainingType} 训练面板`}>
    {bindings.length > 0 && <label className="observation-field">{trainingType} 运行版本<select value={runId} onChange={event => setSelectedRun(event.target.value)}>{bindings.map(run => <option key={run.run_id} value={run.run_id}>{run.run_id} · task {run.task_id}</option>)}</select></label>}
    {result?.error && <p role="alert" className="observation-error">{observationMessage(result.error)}</p>}
    {points.length > 0
      ? <div className="observation-metrics">{metrics.map(metric => <MetricChart key={metric.key} metric={metric} points={points} />)}</div>
      : !result?.error && <p className="observation-empty" role="status">{placeholder}</p>}
    {result?.page.message && points.length > 0 && <p className="observation-muted">{observationMessage(result.page.message)}</p>}
    {result?.page.truncated && <p className="observation-muted">正在继续读取训练历史，最多保留最近 1,000 点</p>}
    {result?.page.gap && <p className="observation-error">来源报告数据缺口</p>}
  </section>;
}
