import type { ConversationSnapshot } from '../types';

export function PreparationPanel({ snapshot }: {
  snapshot: ConversationSnapshot;
}) {
  const view = snapshot.preparation;
  if (!view || snapshot.project) return null;
  const nodeRequirements = new Set(view.plan?.stages
    .filter(stage => stage.enabled && !stage.placeholder)
    .flatMap(stage => view.policy.workflow_nodes?.find(node => node.id === stage.kind)?.required_fields ?? []));
  const required = view.policy.fields.filter(field => field.required || nodeRequirements.has(field.key));
  const resolved = required.filter(field => view.facts[field.key]?.status === 'resolved').length;
  return <details aria-label="实验准备" open={!view.plan} className="m-4 max-h-[32vh] shrink-0 overflow-y-auto rounded-lg border bg-slate-50">
    <summary className="cursor-pointer p-3">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">准备 Checklist</h2><span className="text-xs font-medium text-violet-700">{resolved} / {required.length} 必填信息</span></div>
    <div role="progressbar" aria-label="信息收集进度" aria-valuenow={resolved} aria-valuemin={0} aria-valuemax={required.length || 1} className="mt-3 h-1 overflow-hidden rounded bg-slate-200"><div className="h-full bg-violet-600 transition-all" style={{width: `${required.length ? resolved / required.length * 100 : 100}%`}} /></div>
    </summary>
    <div className="min-h-0 overflow-y-auto p-4">
    <p className="mb-3 text-xs text-slate-500">信息可来自对话、只读探查或检索。计划可继续通过对话修改。</p>
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{view.policy.fields.map(field => {
      const fact = view.facts[field.key];
      return <li key={field.key} className="rounded border bg-white p-3 text-xs">
        <div className="flex items-center justify-between gap-2"><strong>{field.label}</strong><span className={fact?.status === 'resolved' ? 'text-emerald-700' : fact?.status === 'conflict' ? 'text-red-700' : 'text-slate-400'}>{fact?.status === 'resolved' ? '✓ 已收集' : fact?.status === 'conflict' ? '存在冲突' : (field.required || nodeRequirements.has(field.key)) ? '待补充' : '选填 · 未提供'}</span></div>
        {field.description && <p className="mt-1 text-[11px] leading-5 text-slate-500">{field.description}</p>}
        {fact?.status === 'resolved' && <details className="mt-1 text-xs text-slate-600"><summary>查看信息与依据</summary>
          <pre className="whitespace-pre-wrap break-words">{typeof fact.value === 'string' ? fact.value : JSON.stringify(fact.value, null, 2)}</pre>
          <p>依据 {fact.evidence_refs.length} 项</p>
        </details>}
      </li>;
    })}</ul>
    {!view.plan && !view.review_pending && <p className="mt-3 text-xs text-slate-500">{view.missing.length ? '补齐必填信息后，Agent 会生成可审阅的工作流计划。' : '信息已收集，等待 Agent 生成工作流计划。'}</p>}
    {view.review_pending && <p className="mt-3 text-sm text-amber-800">正在根据最新对话核对信息与计划。</p>}
    </div>
  </details>;
}
