import { useRef, useState } from 'react';
import type { ConversationSnapshot, ProductPermission, RespondToUserInput, ReadInputMedia } from '../types';
import { UserInputCard } from './UserInputCard';

export type RespondToPermission = (permissionId: string, decision: 'allow_once' | 'deny', commandId: string) => Promise<void>;
export function ProjectConfirmationPanel({ snapshot, onRespond, onPermission, readMedia }: {
  snapshot: ConversationSnapshot;
  onRespond: RespondToUserInput;
  onPermission: RespondToPermission;
  readMedia: ReadInputMedia;
}) {
  if (!snapshot.project) return null;
  const inputs = snapshot.pending_inputs ?? [];
  const permissions = snapshot.pending_permissions;
  const count = inputs.length + permissions.length;
  return <aside aria-label="待确认" className="project-confirmations flex min-h-0 min-w-0 flex-col border-l bg-slate-50">
    <header className="flex shrink-0 items-center justify-between border-b bg-white px-4 py-3"><h2 className="font-semibold">待确认</h2><span role="status" className="rounded-full bg-violet-100 px-2.5 py-1 text-xs text-violet-800">{count} 项</span></header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
      {!count && <div className="rounded-xl border border-dashed bg-white p-6 text-center"><p className="text-sm text-slate-600">暂无待确认事项</p><p className="mt-2 text-xs leading-5 text-slate-400">需要你作决定时，会在这里展示结果与确认操作。</p></div>}
      {inputs.map(request => <UserInputCard
        key={`${snapshot.conversation_id}:${request.request_id}`}
        request={request} onRespond={onRespond} readMedia={readMedia} />)}
      {permissions.map(permission => <PermissionCard key={`${snapshot.conversation_id}:${permission.permission_id}`} permission={permission} onRespond={onPermission} />)}
    </div>
  </aside>;
}

function PermissionCard({permission, onRespond}: {permission: ProductPermission; onRespond: RespondToPermission}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const command = useRef({decision: '', id: ''});
  async function respond(decision: 'allow_once' | 'deny') {
    if (busy) return;
    if (command.current.decision !== decision) command.current = {decision, id: crypto.randomUUID()};
    setBusy(true); setError('');
    try { await onRespond(permission.permission_id, decision, command.current.id); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '提交失败，请重试'); }
    finally { setBusy(false); }
  }
  return <section aria-label="执行确认" aria-busy={busy} className="my-3 rounded-xl border bg-white p-4">
    <h3 className="text-sm font-semibold">执行确认</h3>
    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{permission.description}</p>
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    <div className="mt-4 flex justify-end gap-2">{permission.choices.includes('deny') && <button type="button" disabled={busy} onClick={() => void respond('deny')} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">拒绝</button>}{permission.choices.includes('allow_once') && <button type="button" disabled={busy} onClick={() => void respond('allow_once')} className="rounded-lg bg-violet-600 px-3 py-2 text-sm text-white disabled:opacity-50">允许本次执行</button>}</div>
  </section>;
}
