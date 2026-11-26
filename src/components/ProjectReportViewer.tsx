import { useEffect, useState } from 'react';
import type { RequestOptions } from '../api';
import { modelReportCases, modelReportDocument, modelReportMedia, refreshModelReport, type EvaluationCase, type EvaluationCasePage } from '../echomindOperations';

const button = 'rounded border bg-white px-3 py-1.5 text-xs disabled:opacity-40';
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export function ProjectReportViewer({ projectId, candidateId, requestOptions, onClose }: {
  projectId: string; candidateId: string; requestOptions: RequestOptions; onClose: () => void;
}) {
  const [html, setHtml] = useState('');
  const [documentError, setDocumentError] = useState('');
  const [documentRevision, setDocumentRevision] = useState(0);
  const [documentLoading, setDocumentLoading] = useState(true);
  const [page, setPage] = useState<EvaluationCasePage | null>(null);
  const [caseError, setCaseError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<{cursor: string | null; query: string}>({cursor: null, query: ''});

  useEffect(() => {
    let cancelled = false;
    setDocumentLoading(true);
    setDocumentError('');
    const load = async () => {
      if (documentRevision) await refreshModelReport(projectId, candidateId, requestOptions);
      return modelReportDocument(projectId, candidateId, requestOptions);
    };
    void load().then(result => {
      if (!cancelled) setHtml(result.html);
    }).catch(error => { if (!cancelled) setDocumentError(messageOf(error)); })
      .finally(() => { if (!cancelled) setDocumentLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, candidateId, requestOptions, documentRevision]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCaseError('');
    setPage(null);
    void modelReportCases(projectId, candidateId, selection.cursor, selection.query, requestOptions)
      .then(result => { if (!cancelled) setPage(result); })
      .catch(error => { if (!cancelled) setCaseError(messageOf(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, candidateId, requestOptions, selection]);

  return <section className="mt-3 rounded border border-blue-200 bg-slate-50 p-3" aria-label="评测报告详情">
    <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold">评测报告 · {candidateId.slice(0, 8)}</h4><button className={button} onClick={onClose}>关闭报告</button></div>
    {documentLoading && <p role="status" className="mt-2 text-xs">正在读取报告概览…</p>}
    {documentError && <div className="mt-2 text-xs text-amber-800"><p>报告概览尚未读取：{documentError}</p><button className={`${button} mt-2`} disabled={documentLoading} onClick={() => setDocumentRevision(value => value + 1)}>读取原始报告并重试</button></div>}
    {html && <details className="mt-3"><summary className="cursor-pointer text-xs text-blue-700">打开原始报告概览</summary>
      <iframe title="原始评测报告概览" sandbox="allow-scripts" referrerPolicy="no-referrer" className="mt-2 h-[32rem] w-full rounded border bg-white"
        srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'">${html}`} />
    </details>}
    <form className="mt-3 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); setSelection({cursor: null, query: query.trim()}); }}>
      <input aria-label="搜索样本 ID" placeholder="搜索样本 ID" className="rounded border p-2 text-xs" value={query} onChange={event => setQuery(event.target.value)} />
      <button className={button} disabled={loading}>搜索 / 重新读取</button>
      {selection.cursor && <button className={button} type="button" disabled={loading} onClick={() => setSelection(current => ({...current, cursor: null}))}>回到第一页</button>}
    </form>
    {caseError && <p role="alert" className="mt-2 text-xs text-red-700">{caseError}</p>}
    {loading && <p role="status" className="mt-2 text-xs">正在读取样本明细…</p>}
    {page && <>
      <p className="mt-2 text-xs text-slate-500">共 {page.total} 条，匹配 {page.filtered_total} 条，本页 {page.items.length} 条。以下内容直接来自本轮 Eval。</p>
      {page.total === 0 && <p className="mt-2 text-xs text-slate-500">本报告没有导出的样本明细。是否保留全部样本或仅保留失败样本，由本轮 Eval 配置决定。</p>}
      <div className="mt-3 space-y-3">{page.items.map(item => <EvaluationCaseCard key={item.id} item={item}
        renderMedia={media => media.media_id ? <CaseImage key={media.media_id} projectId={projectId} candidateId={candidateId} mediaId={media.media_id} caption={media.caption} requestOptions={requestOptions} /> : null} />)}</div>
      {page.next_cursor && <button className={`${button} mt-3`} onClick={() => setSelection(current => ({...current, cursor: page.next_cursor}))}>下一页</button>}
    </>}
  </section>;
}

export function EvaluationCaseCard({item, renderMedia}: {
  item: EvaluationCase; renderMedia: (media: EvaluationCase['media'][number]) => React.ReactNode;
}) {
  const display = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '未记录';
  return <article className="min-w-0 rounded border bg-white p-3 text-xs">
    <h5 className="break-all font-semibold">{item.id} · {item.status === 'passed' ? '通过' : item.status === 'failed' ? '未通过' : item.status} · 得分 {item.overall_score ?? '—'}</h5>
    <div className="mt-2 flex flex-wrap gap-3">{(item.media ?? []).map((media, index) => <figure className="max-w-xs" key={media.media_id ?? index}>
      {renderMedia(media)}{media.caption && <figcaption className="mt-1 break-all text-slate-500">{media.caption}</figcaption>}
    </figure>)}</div>
    <div className="mt-2 grid gap-2 md:grid-cols-2">{[['确认标签 / GT', item.reference], ['模型输出', item.prediction]].map(([label, value]) => <div key={String(label)} className="min-w-0 rounded bg-slate-50 p-2"><p className="font-medium">{String(label)}</p><pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words">{display(value)}</pre></div>)}</div>
    <ul className="mt-2 space-y-1">{(item.rubric_items ?? []).map(rule => <li key={rule.name} className={rule.passed ? 'text-emerald-800' : 'text-red-700'}>{rule.criterion || rule.name}：{rule.passed ? '通过' : '未通过'} · {rule.score}{rule.failure_reason ? ` · ${rule.failure_reason}` : ''}</li>)}</ul>
    {item.error && <p className="mt-2 text-red-700">{item.error}</p>}
    <details className="mt-2"><summary className="cursor-pointer text-slate-500">查看输入</summary><pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words">{display(item.input)}</pre></details>
  </article>;
}

function CaseImage({projectId, candidateId, mediaId, caption, requestOptions}: {
  projectId: string; candidateId: string; mediaId: string; caption?: string; requestOptions: RequestOptions;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    void modelReportMedia(projectId, candidateId, mediaId, requestOptions).then(blob => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(cause => { if (!cancelled) setError(messageOf(cause)); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [projectId, candidateId, mediaId, requestOptions]);
  return error ? <p className="text-red-700">图片读取失败：{error}</p> : url ? <img className="max-h-64 rounded object-contain" src={url} alt={caption ?? '评测样本图片'} /> : <p className="text-slate-500">正在读取图片…</p>;
}
