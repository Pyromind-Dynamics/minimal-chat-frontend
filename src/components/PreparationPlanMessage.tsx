import type { ConversationSnapshot } from '../types';
import { preparationPlanStatus } from '../preparation';
import { WorkflowPlanPreview } from './WorkflowPlanPreview';

const planStatus = {
  input: ['等待补充信息', '请先处理待确认事项。'],
  paused: ['已暂停', '继续执行后即可核对计划。'],
  running: ['正在核对草稿', '本轮执行结束后更新计划状态。'],
  queued: ['等待处理补充需求', '队列处理完后更新计划状态。'],
  ready: ['待确认草稿', '确认此计划后，将创建 Project 并排队启动首个任务。'],
  review_required: ['草稿需要重新核对', '本轮执行已结束，当前草稿仍待核对。重新核对后即可确认。'],
  incomplete: ['草稿尚未就绪', '请在对话中补齐计划所需信息。'],
};

export function PreparationPlanMessage({snapshot, busy, onCreate, onReview}: {
  snapshot: ConversationSnapshot; busy: boolean; onCreate: () => void; onReview: () => void;
}) {
  const view = snapshot.preparation;
  const status = preparationPlanStatus(snapshot);
  if (!view?.plan || !status) return null;
  const [label, detail] = planStatus[status];
  return <section aria-label="工作流计划草稿" tabIndex={-1} className="my-4 rounded-xl border border-violet-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">workflowPLAN</h2><span className="rounded-full bg-violet-50 px-3 py-1 text-xs text-violet-700">{label}</span></div>
    <p className="mt-2 text-xs text-slate-500">尚未创建 Project。你可以在对话中调整阶段、任务和执行范围。</p>
    <WorkflowPlanPreview plan={view.plan} entryTaskId={view.entry_task?.request_id} catalog={view.policy.workflow_nodes} />
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <p className="text-xs text-slate-500">{detail}</p>
      {status === 'ready' && <button type="button" disabled={busy} onClick={onCreate} className="rounded-lg bg-violet-700 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? '正在创建…' : '创建并启动'}</button>}
      {status === 'review_required' && <button type="button" disabled={busy} onClick={onReview} className="rounded-lg bg-violet-700 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? '正在提交…' : '重新核对计划'}</button>}
    </div>
  </section>;
}
