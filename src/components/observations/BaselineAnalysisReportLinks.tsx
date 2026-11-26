import { useEffect, useRef, useState } from 'react';
import type { RequestOptions } from '../../api';
import type { ProductClient } from '../../productClient';

type ReportLinkProps = {
  client: ProductClient;
  options: RequestOptions;
  projectId: string;
  nodeId: string;
};

export function BaselineAnalysisReportLinks({ reportIds, ...props }: ReportLinkProps & { reportIds: string[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return <div className="baseline-report-links">
    {reportIds.map(id => <a key={id} href={props.client.analysisReportUrl(props.projectId, props.nodeId, id)}
      onClick={event => { event.preventDefault(); setSelectedId(id); }}>
      查看归因报告{reportIds.length > 1 && ` · ${id}`}
    </a>)}
    {selectedId && reportIds.includes(selectedId) && <BaselineAnalysisReportDialog
      key={selectedId} {...props} reportId={selectedId} onClose={() => setSelectedId(null)} />}
  </div>;
}

function BaselineAnalysisReportDialog({ client, options, projectId, nodeId, reportId, onClose }: ReportLinkProps & {
  reportId: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [report, setReport] = useState<{ filename: string; text: string }>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void client.observationAnalysisReport(projectId, nodeId, reportId, options, controller.signal)
      .then(result => { if (!controller.signal.aborted) setReport(result); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [client, options, projectId, nodeId, reportId]);

  return <dialog ref={dialog} aria-label="基线解读与 badcase 归因" onCancel={onClose}
    className="baseline-report-dialog">
    <header>
      <h2>基线解读与 badcase 归因</h2>
      <button type="button" onClick={onClose}>关闭</button>
    </header>
    {failed ? <p role="alert">暂时无法读取归因报告，请关闭后重试。</p>
      : report ? <pre>{report.text}</pre>
      : <p role="status">正在读取归因报告…</p>}
  </dialog>;
}
