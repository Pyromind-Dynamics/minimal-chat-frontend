import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { RequestOptions } from '../../api';
import type { ProductClient } from '../../productClient';
import type { MetricConfig, MetricPoint, PanelConfig, RunBinding } from '../../observationsContract';
import { formatTrainingMetric, pointAxis, trainingCurvePath, observationBusinessStatus, observationStageMessage } from '../../observationsPresentation';
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
  const metricPoints = points.filter(point => point.key === metric.key && Number.isFinite(point.value));
  const useEpoch = metric.axis === 'training_step' && metric.axis_key === 'step' &&
    metricPoints.some(point => point.epoch != null) && !metricPoints.some(point => point.training_step != null);
  const data = metricPoints.map(point => ({ point, x: useEpoch ? point.epoch : pointAxis(point, metric) }))
    .filter((item): item is { point: MetricPoint; x: number } => item.x != null && Number.isFinite(item.x))
    .sort((a, b) => a.x - b.x);
  const minX = Math.min(...data.map(item => item.x));
  const maxX = Math.max(...data.map(item => item.x));
  const minY = Math.min(...data.map(item => item.point.value));
  const maxY = Math.max(...data.map(item => item.point.value));
  const x = (value: number) => 82 + (maxX === minX ? 0.5 : (value - minX) / (maxX - minX)) * 324;
  const y = (value: number) => 150 - (maxY === minY ? 0.5 : (value - minY) / (maxY - minY)) * 128;
  const curve = trainingCurvePath(data.map(item => ({ x: x(item.x), y: y(item.point.value) })));
  const axisLabel = useEpoch ? 'epoch' : metric.axis === 'time' ? 'time' : metric.axis_key || 'step';
  const valueLabel = metric.key.replace(/^(train|eval)[/_.]/, '');
  const formatValue = (value: number | null | undefined) => formatTrainingMetric(value, metric);
  const active = data.find(item => item.point.source_point_id === activeId);
  return <section className="observation-metric" aria-label={metric.title}>
    <div className="observation-card-heading"><h4 title={metric.key}>{metric.title}</h4><strong>{formatValue(data.at(-1)?.point.value)}</strong></div>
    {data.length === 0 ? <p className="observation-empty">{points.some(point => point.key === metric.key) ? '数据源未提供当前横轴所需的数据' : '暂无历史指标'}</p> : <>
      <div className="observation-chart" onPointerLeave={() => setActiveId(null)}>
      <svg viewBox="0 0 420 178" role="group" aria-label={`${metric.title}, ${data.length} data points, ${axisLabel}`} onPointerMove={event => {
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
export function TrainingMetricPanel({ client, projectId, panel, binding, configVersion, options }: { client: ProductClient; projectId: string; panel: PanelConfig; binding: RunBinding; configVersion: string; options: RequestOptions }) {
  const metrics = panel.metrics;
  const result = useTrainingObservations(client, projectId, panel.project_node_id, metrics, binding.run_id, configVersion, options, binding);
  const points = result?.points ?? [];
  const loading = metrics.length > 0 && !result;
  const status = observationBusinessStatus(binding.business_status);
  let placeholder = observationStageMessage('训练', binding.business_status === 'cancelled' ? 'cancelled' : status);
  if (status === 'running') placeholder = '训练正在执行，等待指标上报';
  if (status === 'completed') placeholder = '训练已完成，暂无可展示的历史指标';
  if (status === 'failed') placeholder = '训练执行失败，暂无指标';
  if (loading) placeholder = '正在读取训练指标';
  if (result?.page.observation_status === 'unavailable') placeholder = '暂时无法从数据源读取训练指标';
  if (result?.page.observation_status === 'forbidden') placeholder = '当前账号无权查看训练指标';
  return <>
    {result?.error && <p role="alert" className="observation-error">训练指标请求失败，请稍后再试</p>}
    {points.length > 0
      ? <div className="observation-metrics">{metrics.map(metric => <MetricChart key={metric.key} metric={metric} points={points} />)}</div>
      : !result?.error && <p className="observation-empty" role="status">{placeholder}</p>}
    {result?.page.observation_status === 'unavailable' && points.length > 0 && <p className="observation-muted">暂时无法读取新指标，当前显示上次取到的数据</p>}
    {result?.page.truncated && <p className="observation-muted">正在继续读取历史指标，图表保留最近 1,000 个数据点</p>}
    {result?.page.gap && <p className="observation-error">数据源报告部分训练指标缺失</p>}
  </>;
}
