import { Fragment, useState } from 'react';
import type { RequestOptions } from '../../api';
import type {
  ObservationDetailBlock, ObservationDetailSection, ObservationMetricGroup, ObservationNode, ObservationReportIssue, ObservationReportQuery,
  PanelConfig, RunBinding, StageAnalysis,
} from '../../observationsContract';
import { useObservationReport } from '../../hooks/useProjectObservations';
import { formatMetric, matchesObservationReportVersions, observationReportMessage } from '../../observationsPresentation';
import type { ProductClient } from '../../productClient';
import { DatasetResultPanel } from './DatasetResultPanel';
import { TrainingMetricPanel } from './TrainingMetricPanel';

type AnalysisResult = NonNullable<StageAnalysis['result']>;

type Choice = {
  value: string;
  label: string;
  reportVersionId?: string;
  analysisJobId?: string;
  analysis?: StageAnalysis;
  run?: RunBinding;
};

type SectionProps = {
  section: ObservationDetailSection;
  node: ObservationNode;
  status: string;
  reports: StageAnalysis[];
  currentReport?: StageAnalysis;
  bindings: RunBinding[];
  panel?: PanelConfig;
  configVersion: string;
  projectId: string;
  client: ProductClient;
  options: RequestOptions;
  onDeliveryRetry?: () => void;
};

function sectionChoices({ section, node, reports, currentReport, bindings }: SectionProps): Choice[] {
  switch (section.selection) {
    case 'report_version': {
      const versions = new Map<string, string | undefined>();
      for (const id of [...(node.report_version_ids ?? []), ...(node.historical_report_version_ids ?? [])]) versions.set(id, undefined);
      const selectableAnalyses = node.type === 'init' ? [] : reports;
      for (const report of selectableAnalyses.toReversed()) {
        if (report.status !== 'ready') continue;
        for (const id of report.report_ids ?? []) {
          if (!versions.has(id)) versions.set(id, report.job_id);
        }
      }
      return Array.from(versions, ([id, analysisJobId]) => ({
        value: id, label: id, reportVersionId: id, analysisJobId,
        analysis: selectableAnalyses.findLast(report => report.status === 'ready' &&
          report.report_ids?.length === 1 && report.report_ids[0] === id),
      }));
    }
    case 'analysis_version': {
      const history = reports.filter(report => report.status === 'ready' && report.job_id !== currentReport?.job_id);
      const versionedCurrent = node.type === 'eval' && currentReport?.status === 'ready' && currentReport.report_version_id
        ? currentReport : undefined;
      if (node.type === 'eval' && !versionedCurrent && !history.length) return [];
      return [
        { value: versionedCurrent?.job_id ?? '', label: versionedCurrent?.report_version_id ?? 'Current run', analysis: currentReport },
        ...history.map(report => ({ value: report.job_id, label: report.report_version_id ?? report.job_id, analysis: report })),
      ];
    }
    case 'task_id': {
      const byTask = new Map(bindings.map(run => [run.task_id, run]));
      return Array.from(byTask, ([id, run]) => ({ value: id, label: id, run }));
    }
    default:
      return [];
  }
}

function ReportMetrics({ metrics, groups, asTable }: {
  metrics: AnalysisResult['metrics']; groups: ObservationMetricGroup[]; asTable: boolean;
}) {
  const renderMetrics = (items: typeof metrics, title: string, labels: Record<string, string> = {}) => {
    const rows = items.map(({ label, value, unit }) => ({
      label: Object.hasOwn(labels, label) ? labels[label] : label,
      value: formatMetric(value, unit),
    }));
    if (asTable) {
      return <div className="observation-table-frame stage-metric-table-frame">
        <table className="observation-data-table" aria-label={title}>
          <thead><tr><th scope="col">{title}</th><th scope="col">数值</th></tr></thead>
          <tbody>{rows.map(({ label, value }, index) => <tr key={index}>
            <th scope="row">{label}</th><td>{value}</td>
          </tr>)}</tbody>
        </table>
      </div>;
    }
    return <dl className="stage-report-metrics">
      {rows.map(({ label, value }, index) => <div key={index}>
        <dt>{label}</dt><dd>{value}</dd>
      </div>)}
    </dl>;
  };
  const remaining = metrics.filter(metric => !groups.some(group => Object.hasOwn(group.labels, metric.label)));
  return <>
    {groups.map(({ title, labels }) => {
      const groupMetrics = Object.keys(labels).flatMap(label => metrics.filter(metric => metric.label === label));
      return groupMetrics.length > 0 && <section key={title}>
        {!asTable && <h4 className="observation-metric-group">{title}</h4>}
        {renderMetrics(groupMetrics, title, labels)}
      </section>;
    })}
    {remaining.length > 0 && renderMetrics(remaining, groups.length ? '其他指标' : '指标')}
  </>;
}

const statusText = (message: string) => <p className="rsi-detail-help" role="status">{message}</p>;

const deliveryErrorMessages: Record<string, string> = {
  missing_output: '缺少计划声明的产物，请核对产物路径和文件。',
  invalid_output: '产物路径或版本归属无效，请核对当前执行记录。',
  invalid_report: '报告格式无法读取，请核对报告内容。',
  invalid_report_metrics: '主报告缺少可用的结构化指标，请核对报告字段。',
  ambiguous_report: '有多个产物包含结构化指标，请在计划中指定主报告。',
  missing_execution_record: '未能读取本次执行的产物记录，请检查 Storage 和计划文件。',
  credentials_required: '需要有效的 Storage 授权，请检查连接设置。',
  storage_unavailable: '暂时无法访问 Storage，请检查连接设置后重试。',
  version_error: '版本保存失败，请重试登记。',
};

const reportIssueMessages: Record<ObservationReportIssue['code'], string> = {
  invalid_metric: '指标格式无效',
  invalid_count: '应为非负整数',
  invalid_file: '文件路径无效',
  invalid_check: '检查结果无效',
  truncated: '部分指标超出展示上限',
  unreadable_report: '暂时无法读取报告',
  invalid_report: '报告格式无效或超出读取上限',
};

export function ObservationFormSection(props: SectionProps) {
  const { section, node, status, currentReport, bindings, panel, configVersion, projectId, client, options } = props;
  const [selectedValue, setSelectedValue] = useState<string>();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const choices = sectionChoices(props);
  const defaultValue = section.selection === 'task_id' ? bindings.at(-1)?.task_id : choices[0]?.value;
  const selected = choices.find(choice => choice.value === (selectedValue ?? defaultValue)) ??
    choices.find(choice => choice.value === defaultValue);
  const analysis = selected?.analysis ?? (!selected ? currentReport : undefined);
  const needsReport = section.blocks.some(block => block.type === 'dataset_files' ||
    ((block.type === 'metrics' || block.type === 'status') && block.source === 'report'));
  const needsRegisteredMetrics = (node.type === 'train' || node.type === 'eval') && section.selection === 'analysis_version' &&
    !!node.report_version_ids?.length && (!selected || selected.analysis === currentReport) &&
    !analysis?.result?.metrics.length;
  const query: ObservationReportQuery = { project_node_id: node.id };
  if (needsReport) {
    query.report_version_id = selected?.reportVersionId;
    query.analysis_job_id = section.selection === 'analysis_version' && analysis?.status === 'ready'
      ? analysis.job_id : selected?.analysisJobId;
  }
  const reportIds = (needsReport || needsRegisteredMetrics) && section.selection === 'analysis_version'
    ? node.report_version_ids ?? [] : [];
  const source = useObservationReport(client, projectId, query, reportIds, options);
  const report = source.report?.report_version_ids.length ? source.report : undefined;
  const result = needsReport && !report ? undefined : analysis?.result;
  const registeredReport = needsRegisteredMetrics && matchesObservationReportVersions(reportIds, report?.report_version_ids)
    ? report : undefined;
  const issues = (needsReport || registeredReport || (needsRegisteredMetrics && !report))
    ? source.report?.issues ?? [] : [];
  const checks = node.type === 'dataset' ? Object.entries(report?.checks ?? {}) : [];
  const trainingNarrative = node.type === 'train'
    ? section.blocks.findLast(block => block.type === 'summary' || block.type === 'findings')
    : undefined;

  function trainingConclusion() {
    const summaries = [...new Set((result?.summary?.trim()
      ? [result.summary] : registeredReport?.summaries ?? []).map(text => text.trim()).filter(Boolean))];
    const seen = new Set(summaries);
    const findings = [...new Set((result?.findings ?? []).map(text => text.trim()).filter(Boolean))]
      .filter(text => !seen.has(text));
    if (!summaries.length && !findings.length) return null;
    return <section className="training-conclusion" aria-label="训练结论">
      <h5>训练结论</h5>
      {summaries.map(summary => <p key={summary}>{summary}</p>)}
      {findings.length > 0 && <ul>{findings.map(finding => <li key={finding}>{finding}</li>)}</ul>}
    </section>;
  }

  if (section.selection === 'task_id' && !selected?.run) return null;

  async function retryDelivery(reportVersionId?: string) {
    setRetrying(true);
    setRetryError(false);
    try {
      const retry = await client.retryArtifactDelivery(projectId, node.id, options, reportVersionId);
      if (retry.report_version_id) setSelectedValue(retry.report_version_id);
      props.onDeliveryRetry?.();
    } catch {
      setRetryError(true);
    } finally {
      setRetrying(false);
    }
  }
  const deliveryNotice = section.selection !== 'task_id' && (
    node.delivery_status === 'pending' ? statusText('结果已返回，等待提交报告') :
    node.delivery_status === 'registering' ? statusText('正在登记产物') :
    node.delivery_status === 'failed' ? <>
      {statusText(`产物登记失败。 ${deliveryErrorMessages[node.delivery_error ?? ''] ?? '请检查当前执行的产物。'}`)}
      {node.delivery_error_field && <p className="observation-muted">失败字段 <code>{node.delivery_error_field}</code></p>}
      {retryControl('重试登记')}
    </> : null
  );

  function retryControl(label: string, reportVersionId?: string) {
    return <>
      {retryError && <p role="alert" className="observation-error">登记未完成，请核对连接设置和已登记的报告来源。</p>}
      <button type="button" className="observation-report-retry" disabled={retrying}
        onClick={() => void retryDelivery(reportVersionId)}>{retrying ? '正在登记' : label}</button>
    </>;
  }

  function renderBlock(block: ObservationDetailBlock) {
    switch (block.type) {
      case 'select':
        return selected && choices.length >= (block.min_options ?? 1) && <label className="observation-field">{block.label}
          <select value={selected.value} onChange={event => setSelectedValue(event.target.value)}>
            {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select>
        </label>;
      case 'status':
        if (deliveryNotice && !selected) return null;
        if (block.source === 'analysis' && result) return null;
        if (block.source === 'analysis' && needsRegisteredMetrics && reportIds.length) {
          if (source.loading) return statusText('正在读取已登记的报告');
          if (source.unavailable) return <>
            {statusText('暂时无法读取已登记的报告')}
            <button type="button" className="observation-report-retry" onClick={source.retry}>重试</button>
          </>;
          if (!registeredReport) return statusText('已登记的报告未通过当前执行归属校验');
          if (analysis?.status === 'failed') return statusText(`${block.subject}报告已登记，阶段分析暂不可用`);
          if (analysis?.status === 'queued' || status === 'report_ready_pending_analysis') {
            return statusText('报告已交付，等待阶段分析');
          }
          return null;
        }
        if (block.source === 'report') {
          if (source.loading) return statusText(block.loading_message || '正在读取报告');
          if (source.unavailable) return <>
            {statusText(block.unavailable_message || '暂时无法读取报告')}
            <button type="button" className="observation-report-retry" onClick={source.retry}>重试</button>
          </>;
          if (report) return status === 'report_ready_pending_analysis'
            ? statusText('报告已交付，等待阶段分析') : null;
          if (source.report) return statusText('已登记的报告未通过当前执行归属校验');
        }
        return deliveryNotice ? null : statusText(observationReportMessage(block.subject, status, analysis?.status));
      case 'metrics': {
        const metrics = block.source === 'report' ? report?.metrics : registeredReport?.metrics ?? result?.metrics;
        const reportId = selected?.reportVersionId;
        if (node.type === 'init' && block.source === 'report' && metrics?.length === 0 && reportId
          && node.report_version_ids?.includes(reportId)) {
          return <>
            {statusText(block.empty_message || '所选报告未提供结构化指标')}
            {retryControl('从原始产物补登指标', reportId)}
          </>;
        }
        return metrics?.length ? <ReportMetrics metrics={metrics} groups={block.groups ?? []} asTable={node.type === 'init' || node.type === 'train' || node.type === 'eval'} />
          : metrics && block.empty_message ? statusText(block.empty_message) : null;
      }
      case 'dataset_files':
        return report?.files.length ? <DatasetResultPanel files={report.files} />
          : report && statusText(block.empty_message);
      case 'summary':
        if (trainingNarrative) return block === trainingNarrative ? trainingConclusion() : null;
        return result?.summary ? <p>{result.summary}</p> : registeredReport?.summaries?.map(summary => <p key={summary}>{summary}</p>);
      case 'findings':
        if (trainingNarrative) return block === trainingNarrative ? trainingConclusion() : null;
        return result && result.findings.length > 0 && <ul>{result.findings.map((finding, index) => <li key={index}>{finding}</li>)}</ul>;
      case 'artifacts':
        return result && result.artifacts.length > 0 && <details className="stage-report-artifacts">
          <summary>Verified artifacts</summary>
          <dl>{result.artifacts.map(artifact => <div key={artifact.artifact_id}>
            <dt>{artifact.name}</dt><dd><code>{artifact.storage_ref}</code></dd>
          </div>)}</dl>
        </details>;
      case 'analysis_version':
        return result && analysis?.report_version_id && <p className="observation-muted">Report version {analysis.report_version_id}</p>;
      case 'training_curves':
        return panel && selected?.run && <TrainingMetricPanel client={client} projectId={projectId} panel={panel}
          binding={selected.run} configVersion={configVersion} options={options} />;
      default:
        return null;
    }
  }

  const blocks = section.blocks.map(block => renderBlock(block));
  if (!deliveryNotice && !blocks.some(Boolean) && !issues.length && !checks.length) return null;
  const trainingHeading = node.type === 'train'
    ? section.selection === 'task_id' ? '训练过程曲线' : '训练报告汇总'
    : null;
  return <section className="observation-card" aria-label={section.label}>
    {trainingHeading && <h4 className="observation-section-title">{trainingHeading}</h4>}
    {deliveryNotice}
    {blocks.map((block, index) => <Fragment key={index}>{block}</Fragment>)}
    {checks.length > 0 && <details className="stage-report-artifacts">
      <summary>数据检查（{checks.length}）</summary>
      <dl>{checks.map(([label, passed]) => <div key={label}>
        <dt>{label}</dt><dd>{passed ? '通过' : '未通过'}</dd>
      </div>)}</dl>
    </details>}
    {issues.length > 0 && <details className="stage-report-artifacts">
      <summary>产物校验提示（{issues.length}）</summary>
      <ul>{issues.map(issue => <li key={`${issue.field}:${issue.code}`}>
        <code>{issue.field}</code> · {reportIssueMessages[issue.code]}
      </li>)}</ul>
    </details>}
  </section>;
}
