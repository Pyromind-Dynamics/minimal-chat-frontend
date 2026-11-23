import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { RequestOptions } from '../../api';
import type { ModelEvaluationObservation } from '../../observationsContract';
import type { ProductClient } from '../../productClient';
import { EvaluationSummaryPanel } from './EvaluationSummaryPanel';

type ReportRequest = { client: ProductClient; projectId: string; options: RequestOptions };

function HistoricalBaselineReport({ client, projectId, taskId, options }: ReportRequest & { taskId: string }) {
  const { cookie, xCluster, userId } = options;
  const auth = useMemo(() => ({ cookie, xCluster, userId }), [cookie, xCluster, userId]);
  const [result, setResult] = useState<{ auth: RequestOptions; report: ModelEvaluationObservation | null } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void client.baselineReport(projectId, taskId, auth, controller.signal).then(
      report => {
        if (!controller.signal.aborted) setResult({ auth, report: report.task_id === taskId ? report : null });
      },
      () => {
        if (!controller.signal.aborted) setResult({ auth, report: null });
      },
    );
    return () => controller.abort();
  }, [client, projectId, taskId, auth]);

  if (result?.auth !== auth) return <p className="rsi-detail-help" role="status">正在读取基线评估报告</p>;
  if (!result.report) return <p className="observation-error" role="alert">基线评估报告暂不可用</p>;
  return <>
    <dl className="observation-facts">
      <dt>平台任务</dt><dd>{taskId}</dd>
      {result.report.model_reference && <><dt>基线模型</dt><dd>{result.report.model_reference}</dd></>}
    </dl>
    <EvaluationSummaryPanel report={result.report} />
  </>;
}

export function BaselineReportHistory({ client, projectId, options, taskIds, currentTaskId, current }: ReportRequest & {
  taskIds: string[];
  currentTaskId?: string | null;
  current?: ReactNode;
}) {
  const [selected, setSelected] = useState('');
  const history = taskIds.filter(id => id !== currentTaskId);
  const taskId = history.includes(selected) ? selected : current ? '' : history[0] ?? '';
  const showSelector = history.length > (current ? 0 : 1);

  return <>
    {showSelector && <label className="observation-field">基线评估报告
      <select value={taskId} onChange={event => setSelected(event.target.value)}>
        {current && <option value="">{currentTaskId ? `当前任务 · ${currentTaskId}` : '当前任务'}</option>}
        {history.map(id => <option key={id} value={id}>历史任务 · {id}</option>)}
      </select>
    </label>}
    {taskId
      ? <HistoricalBaselineReport key={taskId} client={client} projectId={projectId} taskId={taskId} options={options} />
      : current}
  </>;
}
