import { useRef, useState, type FormEvent } from 'react';
import type { RequestOptions } from '../api';
import { demoCollectionSelection, startDemoCollection, type CollectionSimulation } from '../echomindResources';

const inputClass = 'mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm';

export function DemoImageCollection({projectId, imageRoot, previous, batchSize, datasetLabels, fixedValidation, disabled, requestOptions, onStarted}: {
  projectId: string;
  imageRoot: string;
  previous?: CollectionSimulation | null;
  batchSize: number;
  datasetLabels?: boolean;
  fixedValidation?: boolean;
  disabled: boolean;
  requestOptions: RequestOptions;
  onStarted: (simulation: CollectionSimulation) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lastRequest = useRef<{params: string; id: string} | null>(null);
  const submitting = useRef(false);
  const selection = demoCollectionSelection(previous);
  const root = imageRoot.replace(/\/+$/, '');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || submitting.current) return;
    const data = new FormData(event.currentTarget);
    const inputs = {
      image_directory: String(data.get('directory') ?? '').trim(),
      offset: Number(data.get('first_group')) - 1,
      limit: batchSize,
    };
    if (!inputs.image_directory || !Number.isSafeInteger(inputs.offset) || inputs.offset < 0
      || !Number.isSafeInteger(inputs.limit) || inputs.limit < 1) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const params = JSON.stringify(inputs);
      if (lastRequest.current?.params !== params) lastRequest.current = {params, id: crypto.randomUUID()};
      const simulation = await startDemoCollection(projectId, {request_id: lastRequest.current.id, ...inputs}, requestOptions);
      onStarted(simulation);
      lastRequest.current = null;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <form aria-label="图片采集演示" onSubmit={event => void submit(event)} className="mt-3 rounded border border-blue-200 p-3">
    <fieldset disabled={busy || disabled} className="grid gap-2 text-xs text-slate-700 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
      <label>Storage 图片目录<input name="directory" required maxLength={4000} defaultValue={selection?.directory ?? (root.endsWith('/images') ? root : `${root}/images`)} className={inputClass} /></label>
      <label>从第几组开始<input name="first_group" type="number" min={1} step={1} required defaultValue={selection?.firstGroup ?? 1} className={inputClass} /></label>
      <label>每批采集条数<input name="limit" type="number" readOnly value={batchSize} className={`${inputClass} bg-slate-50`} /></label>
    </fieldset>
    <p className="mt-2 text-xs text-slate-600">
      {datasetLabels ? '封批后由 Dataset 通过平台 DataFlow 预打标。' : '缺少标签的样本由当前 Inference 预标注。'}
      {fixedValidation
        ? `本批 ${batchSize} 组全部用于训练。训练验证使用固定验证集，Eval 使用独立评测集。起始位置按排除这两个集合后的顺序计算。`
        : '训练和验证样本按执行方案划分。'}
    </p>
    <p className="mt-1 text-xs text-slate-600">封批后自动进入 Dataset → Train → Eval。</p>
    {error && <p role="alert" className="mt-2 break-words text-xs text-red-700">{error}</p>}
    <button type="submit" disabled={busy || disabled} className="mt-2 rounded bg-blue-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
      {busy ? '正在提交…' : `采集 ${batchSize} 条并运行一轮`}
    </button>
  </form>;
}
