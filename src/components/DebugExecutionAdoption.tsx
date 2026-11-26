import { useEffect, useRef, useState } from 'react';
import type { RequestOptions } from '../api';
import type { DebugExecutionAdoptionPreview, DebugExecutionCandidate } from '../echomindRuntime';
import type { ProductClient } from '../productClient';

const FIELD_LABELS: Record<string, string> = {
  executor: '执行器',
  launch_mode: '启动方式',
  implementation_ref: '工作流引用',
  implementation_digest: '工作流版本',
  inputs: '输入绑定',
  outputs: '输出绑定',
  policies: '执行策略',
  'config.dataset_runtime': 'Dataset 工作流',
  'config.train_runtime': 'Train 工作流',
  'config.evaluator_runtime': 'Eval 工作流',
  'config.runtime_input_defaults': '运行输入默认值',
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function candidateLabel(candidate: DebugExecutionCandidate): string {
  const date = candidate.finished_at ? ` · ${new Date(candidate.finished_at).toLocaleString()}` : '';
  return `${candidate.run_id.slice(0, 8)} · ${candidate.source_project_name}${date}`;
}

export function DebugExecutionAdoption({
  client, projectId, requestOptions, disabled, revision, adopted, preferredRunId, onAdopt,
}: {
  client: ProductClient;
  projectId: string;
  requestOptions: RequestOptions;
  disabled: boolean;
  revision: string;
  adopted?: DebugExecutionCandidate | null;
  preferredRunId?: string;
  onAdopt: (preview: DebugExecutionAdoptionPreview) => void;
}) {
  const section = useRef<HTMLElement>(null);
  const [candidates, setCandidates] = useState<DebugExecutionCandidate[]>([]);
  const [selectedRun, setSelectedRun] = useState(preferredRunId ?? '');
  const [preview, setPreview] = useState<DebugExecutionAdoptionPreview | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const selected = candidates.find(candidate => candidate.run_id === selectedRun);

  useEffect(() => {
    if (!preferredRunId) return;
    section.current?.focus({preventScroll: true});
    section.current?.scrollIntoView({block: 'start'});
  }, [preferredRunId]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setListError(null);
    void client.listDebugExecutionCandidates(projectId, requestOptions).then(items => {
      if (!current) return;
      setCandidates(items);
      setSelectedRun(previous => items.some(item => item.run_id === previous)
        ? previous : items[0]?.run_id ?? '');
    }).catch(failure => {
      if (current) setListError(messageOf(failure));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [client, projectId, requestOptions, reload, revision]);

  useEffect(() => {
    let current = true;
    setPreview(null);
    setPreviewError(null);
    if (!selected || selected.run_id === adopted?.run_id) {
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    void client.previewDebugExecutionAdoption(projectId, selected.source_project_id, selected.run_id, requestOptions)
      .then(result => { if (current) setPreview(result); })
      .catch(failure => { if (current) setPreviewError(messageOf(failure)); })
      .finally(() => { if (current) setPreviewLoading(false); });
    return () => { current = false; };
  }, [adopted?.run_id, client, projectId, requestOptions, revision, reload, selected]);

  return <section ref={section} tabIndex={-1} aria-label="采用调试方案" className="mt-4 border-t pt-3 text-xs">
    <div className="flex items-center justify-between gap-2">
      <h4 className="font-semibold">采用通过的调试方案</h4>
      <button type="button" disabled={loading || disabled} onClick={() => setReload(current => current + 1)} className="rounded border px-2 py-1 disabled:opacity-40">刷新调试记录</button>
    </div>
    {loading && <p role="status" className="mt-2 text-slate-500">正在读取通过的调试记录…</p>}
    {listError && <p role="alert" className="mt-2 text-red-800">{listError}</p>}
    {!loading && !listError && !candidates.length && <p className="mt-2 text-slate-500">完成一次调试后，可在这里采用通过的版本。</p>}
    {!!candidates.length && <label className="mt-2 block">
      <span className="text-slate-600">通过的调试记录</span>
      <select value={selectedRun} disabled={disabled || loading} onChange={event => {
        setPreview(null);
        setSelectedRun(event.target.value);
      }} className="mt-1 block w-full rounded border bg-white px-2 py-1.5">
        {candidates.map(candidate => <option key={candidate.run_id} value={candidate.run_id}>{candidateLabel(candidate)}</option>)}
      </select>
    </label>}
    {!!selected?.reused_node_ids?.length && <p className="mt-2 text-slate-600">复用产物的节点：{selected.reused_node_ids.join('、')}</p>}
    {previewLoading && <p role="status" className="mt-2 text-slate-500">正在对比执行方案…</p>}
    {previewError && <p role="alert" className="mt-2 text-red-800">{previewError}</p>}
    {selected && selected.run_id === adopted?.run_id && <p className="mt-2 text-emerald-800">已采用本次调试方案。</p>}
    {preview && preview.source.run_id === selectedRun && <>
      <p className="mt-2 break-all text-slate-600">调试快照 <code>{preview.source.release_id}</code></p>
      {preview.changes.length ? <ul className="mt-2 list-inside list-disc space-y-1 text-slate-600">
        {preview.changes.map(change => <li key={change.node_id}>{change.node_id} · {change.changed_fields.map(field => FIELD_LABELS[field] ?? field).join('、')}</li>)}
      </ul> : <p className="mt-2 text-slate-600">执行配置一致，采用后会记录本次调试来源。</p>}
      <button type="button" disabled={disabled || loading || previewLoading} onClick={() => onAdopt(preview)} className="mt-3 rounded border border-blue-200 px-3 py-1.5 font-medium text-blue-800 disabled:opacity-40">采用本次调试方案</button>
    </>}
  </section>;
}
