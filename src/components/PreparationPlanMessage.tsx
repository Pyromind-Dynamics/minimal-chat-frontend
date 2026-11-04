import type { ConversationSnapshot } from '../types';
import { canCreateProject } from '../preparation';
import { WorkflowPlanPreview } from './WorkflowPlanPreview';

export function PreparationPlanMessage({snapshot, busy, onCreate}: {
  snapshot: ConversationSnapshot; busy: boolean; onCreate: () => void;
}) {
  const view = snapshot.preparation;
  if (!view?.plan || snapshot.project) return null;
  return <section aria-label="工作流计划草稿" className="my-4 rounded-xl border border-violet-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">workflowPLAN</h2><span className="rounded-full bg-violet-50 px-3 py-1 text-xs text-violet-700">{view.review_pending ? '正在更新草稿' : '待确认草稿'}</span></div>
    <p className="mt-2 text-xs text-slate-500">尚未创建 Project。你可以在对话中调整阶段、任务和执行范围。</p>
    <WorkflowPlanPreview plan={view.plan} entryTaskId={view.entry_task?.request_id} catalog={view.policy.workflow_nodes} />
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <p className="text-xs text-slate-500">{canCreateProject(snapshot) ? '确认此计划后，将创建 Project 并排队启动首个任务。' : view.review_pending ? '正在根据最新对话核对信息与计划，请等待本轮结束。' : '请先完成信息核对与待回答问题。'}</p>
      {canCreateProject(snapshot) && <button type="button" disabled={busy} onClick={onCreate} className="rounded-lg bg-violet-700 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? '正在创建…' : '创建并启动'}</button>}
    </div>
  </section>;
}
