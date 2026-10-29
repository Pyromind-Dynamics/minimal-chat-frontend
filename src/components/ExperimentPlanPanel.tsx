import { useId } from 'react';
import { layoutPlan, planDiff, type ExperimentPlanView, type PlanRevision, type WorkflowPlan } from '../experimentPlans';

export function ExperimentPlanPanel({ view, selectedRevision, busy, onDecision, onHistory, onRefresh }: {
  view: ExperimentPlanView | null | undefined;
  selectedRevision: PlanRevision | null;
  busy: boolean;
  onDecision: (accept: boolean) => void;
  onHistory: (revision: number | null) => void;
  onRefresh: () => void;
}) {
  const pending = view?.pending_proposal;
  const displayed = selectedRevision?.plan ?? pending?.plan ?? view?.current?.plan;
  const diff = pending && view?.current ? planDiff(view.current.plan, pending.plan) : [];
  return <aside className="experiment-plan-panel min-w-0 overflow-y-auto border-l border-slate-200 bg-slate-50 p-4" aria-label="实验计划">
    <div className="flex items-center justify-between gap-2">
      <h2 className="font-semibold">实验计划</h2>
      <button type="button" onClick={onRefresh} disabled={busy} className="text-sm text-blue-700 disabled:opacity-40">刷新</button>
    </div>
    <p className="mt-2 text-xs text-slate-500">通过对话设计与修改计划，确认后保存版本。</p>
    {view?.project_id && <p className="mt-3 break-all text-xs text-slate-600">项目 {view.project_id} · 当前版本 {view.current_revision}</p>}
    {view && view.history.length > 0 && <label className="mt-3 block text-sm">查看版本
      <select aria-label="查看计划版本" value={selectedRevision?.revision ?? ''} onChange={event => onHistory(event.target.value ? Number(event.target.value) : null)} className="ml-2 rounded border bg-white px-2 py-1">
        <option value="">当前计划与提案</option>
        {view.history.map(item => <option key={item.revision} value={item.revision}>版本 {item.revision} · {item.name}</option>)}
      </select>
    </label>}
    {!displayed && <p className="my-8 text-sm text-slate-500">在对话中说明实验目标，Manager 将生成计划草稿。</p>}
    {selectedRevision && <p className="mt-4 text-sm text-slate-600">历史版本 {selectedRevision.revision} · {new Date(selectedRevision.confirmed_at).toLocaleString()}</p>}
    {!selectedRevision && pending && <section className="mt-4 rounded border border-amber-200 bg-amber-50 p-3">
      <h3 className="text-sm font-semibold">{view?.current ? '修改提案 · 待确认' : '计划草稿 · 待确认'}</h3>
      <p className="mt-2 whitespace-pre-wrap text-sm">{pending.summary}</p>
      {pending.changes.length > 0 && <ul className="mt-2 list-inside list-disc text-xs leading-6">{pending.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>}
      <p className="mt-2 text-xs text-slate-600">确认保存计划后，各阶段仍为尚未执行。</p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={() => onDecision(true)} className="rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-40">{view?.current ? '确认保存新版本' : '确认创建项目和计划'}</button>
        <button type="button" disabled={busy} onClick={() => onDecision(false)} className="rounded border bg-white px-3 py-2 text-sm disabled:opacity-40">拒绝提案</button>
      </div>
    </section>}
    {!selectedRevision && diff.length > 0 && <details className="mt-4" open>
      <summary className="text-sm font-medium">相对当前版本的变化</summary>
      <table className="mt-2 w-full table-fixed border-collapse text-xs"><thead><tr><th className="w-1/4 p-1 text-left">内容</th><th className="p-1 text-left">当前</th><th className="p-1 text-left">提案</th></tr></thead>
        <tbody>{diff.map((row, index) => <tr key={index} className="border-t"><th className="break-words p-1 text-left align-top font-medium">{row.label}</th><td className="whitespace-pre-wrap break-words p-1 align-top">{row.before}</td><td className="whitespace-pre-wrap break-words p-1 align-top">{row.after}</td></tr>)}</tbody>
      </table>
    </details>}
    {displayed && <PlanDetails plan={displayed} />}
    {!selectedRevision && pending && view?.current && <details className="mt-5"><summary className="text-sm font-medium">当前已确认计划 · 版本 {view.current_revision}</summary><PlanDetails plan={view.current.plan} /></details>}
  </aside>;
}

function PlanDetails({ plan }: { plan: WorkflowPlan }) {
  const arrowId = useId().replaceAll(':', '');
  const { nodes, width, height } = layoutPlan(plan);
  return <section className="mt-5 space-y-4">
    <div><h3 className="font-semibold">{plan.name}</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{plan.goal}</p></div>
    {plan.unresolved.length > 0 && <div className="rounded border border-amber-200 p-3 text-sm"><h4 className="font-medium">待补充</h4><ul className="mt-1 list-inside list-disc">{plan.unresolved.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    <svg role="img" aria-label="实验阶段关系图" viewBox={`0 0 ${width} ${height}`} className="w-full rounded border border-slate-200 bg-white">
      <defs><marker id={arrowId} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#64748b" /></marker></defs>
      {plan.edges.map(edge => {
        const source = nodes.find(node => node.id === edge.source), target = nodes.find(node => node.id === edge.target);
        if (!source || !target) return null;
        return <path key={`${edge.source}:${edge.target}`} d={`M${source.x + 80},${source.y + 65} L${target.x + 80},${target.y - 2}`} stroke="#64748b" strokeWidth="1.5" markerEnd={`url(#${arrowId})`}><title>{`${source.name} → ${target.name}`}</title></path>;
      })}
      {nodes.map(node => <g key={node.id}>
        <rect x={node.x} y={node.y} width="160" height="65" rx="8" fill={node.enabled ? '#eff6ff' : '#f1f5f9'} stroke={node.enabled ? '#93c5fd' : '#cbd5e1'} strokeDasharray={node.placeholder ? '4 3' : undefined} />
        <text x={node.x + 80} y={node.y + 25} textAnchor="middle" fontSize="14" fill="#0f172a">{node.name}</text>
        <text x={node.x + 80} y={node.y + 47} textAnchor="middle" fontSize="11" fill="#64748b">{node.placeholder ? '占位 · 未启用' : node.enabled ? '尚未执行' : '未启用 · 尚未执行'}</text>
      </g>)}
    </svg>
    {plan.resources.length > 0 && <div><h4 className="text-sm font-medium">已知资源</h4>{plan.resources.map(resource => <div key={resource.id} className="mt-2 break-all text-xs"><strong>{resource.name}</strong><p>{resource.uri || '地址待补充'}</p><p>{resource.description}</p></div>)}</div>}
    {plan.stages.map(stage => <details key={stage.id} className="rounded border border-slate-200 bg-white p-3">
      <summary className="text-sm font-medium">{stage.name} · {stage.placeholder ? '占位' : stage.enabled ? '尚未执行' : '未启用'}</summary>
      <p className="mt-2 text-xs text-slate-600">{stage.description}</p>
      {plan.tasks.filter(task => task.stage_id === stage.id).map(task => <section key={task.id} className="mt-3 border-t pt-3 text-xs">
        <h5 className="font-semibold">{task.name}</h5><p className="mt-1 whitespace-pre-wrap">{task.description}</p>
        {task.inputs.length > 0 && <div className="mt-2"><strong>输入</strong>{task.inputs.map(input => <p key={input.name}>{input.name} ← {input.resource_id ? plan.resources.find(resource => resource.id === input.resource_id)?.name : plan.tasks.find(upstream => upstream.id === input.task_id)?.name}{input.output_name ? ` / ${input.output_name}` : ''}</p>)}</div>}
        {task.outputs.length > 0 && <div className="mt-2"><strong>预期产物</strong>{task.outputs.map(output => <p key={output.name}>{output.name}：{output.description}</p>)}</div>}
        {task.completion_conditions.length > 0 && <div className="mt-2"><strong>完成条件声明</strong>{task.completion_conditions.map((condition, index) => <p key={index}>{condition.description}</p>)}</div>}
      </section>)}
    </details>)}
  </section>;
}
