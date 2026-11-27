import { MarkdownContent } from './MarkdownContent';
import { RegisteredReportContent } from './RegisteredReportContent';
import { useEffect, useRef, useState } from 'react';
import type { RequestOptions } from '../api';
import type { EchoMindChatClient, ProductClient } from '../productClient';

export function ReportDeliveryPreview({ managerId, projectId, client, projectClient, options }: {
  managerId: string; projectId?: string | null; client: EchoMindChatClient; projectClient: ProductClient; options: RequestOptions;
}) {
  const [hash, setHash] = useState(() => typeof window === 'undefined' ? '' : window.location.hash || '');
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<{ text?: string; url?: string; error?: boolean; task_source_text?: string; task_source_markdown?: string }>({});
  const params = new URLSearchParams(hash.slice(1));
  const report = params.get('echomind-report');
  const file = params.get('file');
  const readable = params.get('view') === 'readable';
  const attributionNode = readable && !file ? params.get('attribution-node') : null;
  const title = attributionNode ? '基线解读与 badcase 归因' : '报告预览';
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    if (!report) return;
    const controller = new AbortController();
    const signal = controller.signal;
    setPreview({});
    dialog.current?.showModal();
    async function load(id: string) {
      if (file) {
        const { url } = await client.reportFile(managerId, id, file, options, signal);
        if (!/^https?:$/.test(new URL(url).protocol)) throw new Error('Invalid report URL');
        if (!signal.aborted) setPreview({ url });
      } else if (attributionNode && projectId) {
        const result = await projectClient.observationAnalysisReport(projectId, attributionNode, id, options, signal);
        if (!signal.aborted) setPreview(result);
      } else {
        const { text } = await client.report(managerId, id, options, signal);
        let body = text;
        if (!readable) {
          try { body = JSON.stringify(JSON.parse(text), null, 2); } catch { /* Keep text reports intact. */ }
        }
        if (!signal.aborted) setPreview({ text: body });
      }
    }
    void load(report).catch(() => { if (!signal.aborted) setPreview({ error: true }); });
    return () => controller.abort();
  }, [managerId, projectId, client, projectClient, options, report, file, readable, attributionNode]);
  if (!report) return null;
  const close = () => {
    const url = new URL(window.location.href);
    url.hash = '';
    window.history.replaceState(null, '', url);
    setHash('');
  };
  return <dialog ref={dialog} aria-label={title} onCancel={close} className="baseline-report-dialog">
    <header><h2>{title}{!attributionNode && ' · ' + report}</h2><button type="button" onClick={close}>关闭</button></header>
    {preview.url ? <iframe title="只读报告" src={preview.url} sandbox="allow-scripts" referrerPolicy="no-referrer"
      className="h-[65dvh] w-full border-0" /> : preview.task_source_text ? <div className="grid gap-3">
        <p className="text-sm">本次基线任务的归因原稿</p>
        {preview.task_source_markdown ? <MarkdownContent imageClassName="max-w-full">{preview.task_source_markdown}</MarkdownContent>
          : <RegisteredReportContent attribution text={preview.task_source_text} />}
        <details><summary className="cursor-pointer">查看已登记版本 {report}</summary><pre>{preview.text}</pre></details>
      </div> : preview.text !== undefined ? (readable ? <RegisteredReportContent attribution={!!attributionNode} text={preview.text} /> : <pre>{preview.text}</pre>)
      : <p role="status">{preview.error ? '暂时无法读取这份报告。' : '正在读取报告…'}</p>}
  </dialog>;
}
