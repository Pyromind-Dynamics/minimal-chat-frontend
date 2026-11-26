import { useEffect, useState } from 'react';
import type { RequestOptions } from '../api';
import { refreshStorageBinding, saveStorageBinding, storageBinding, type StorageBinding } from '../echomindOperations';

export function ProjectStorageBinding({projectId, requestOptions}: {projectId: string; requestOptions: RequestOptions}) {
  const [binding, setBinding] = useState<StorageBinding | null>(null);
  const [sandboxId, setSandboxId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void storageBinding(projectId, requestOptions).then(value => {
      if (!cancelled) { setBinding(value); setSandboxId(value?.config.sandbox_id ?? ''); }
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [projectId, requestOptions]);

  async function save(refresh: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    try { setBinding(await (refresh ? refreshStorageBinding(projectId, requestOptions) : saveStorageBinding(projectId, sandboxId.trim(), requestOptions))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  return <details className="mt-3 rounded border p-3 text-xs">
    <summary className="cursor-pointer font-medium">后台 Storage 访问 · {binding?.status === 'ready' ? '已绑定' : binding ? '需要处理' : '未绑定'}</summary>
    <p className="mt-2 text-slate-500">绑定本账号在 Project 集群中运行的 Sandbox，用于后台读取标注、生成批次数据和归档报告。需要挂载 /workspace；实例停止后须恢复或重新绑定。</p>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label>Sandbox ID <input value={sandboxId} onChange={event => setSandboxId(event.target.value)} placeholder="sb-…" className="ml-2 rounded border p-2 font-mono" /></label>
      <button className="rounded border px-3 py-2 disabled:opacity-40" disabled={busy || !sandboxId.trim()} onClick={() => void save(false)}>验证并绑定</button>
      {binding && <button className="rounded border px-3 py-2 disabled:opacity-40" disabled={busy} onClick={() => void save(true)}>重新检查</button>}
    </div>
    {binding && <p className="mt-2 text-slate-500">{binding.cluster} · {binding.config.sandbox_id} · {binding.config.mount_root}</p>}
    {(error || binding?.last_error) && <p role="alert" className="mt-2 text-red-700">{error || binding?.last_error}</p>}
    {busy && <p role="status" className="mt-2">正在验证 Storage 访问…</p>}
  </details>;
}
