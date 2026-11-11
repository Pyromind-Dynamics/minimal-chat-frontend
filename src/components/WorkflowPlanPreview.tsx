import { useId } from 'react';
import type { ExperimentStage } from '../workflowPlan';
import type { WorkflowContext, WorkflowNodeDefinition } from '../preparation';

export function WorkflowStageRow({ plan, status, catalog = [], columnWidth = 260 }: {
  plan: Pick<WorkflowContext, 'stages' | 'edges' | 'tasks'>;
  status?: (stage: ExperimentStage) => string;
  catalog?: WorkflowNodeDefinition[];
  columnWidth?: number;
}) {
  const arrowId = useId().replaceAll(':', '');
  const width = Math.max(plan.stages.length, 1) * columnWidth + Math.max(plan.stages.length - 1, 0) * 12;
  const label = (stage: ExperimentStage) => {
    const node = catalog.find(node => node.id === stage.kind);
    const kinds = new Set((plan.tasks ?? []).filter(task => task.stage_id === stage.id).map(task => task.kind));
    return (kinds.size === 1 ? node?.tasks.find(task => kinds.has(task.id))?.display_name : null) ?? node?.name ?? stage.name;
  };
  return <div className="min-w-fit" style={{width}}>
    {plan.edges.length > 0 && <svg role="img" aria-label="工作流阶段依赖关系" viewBox={`0 0 ${width} 64`} className="h-16 w-full">
      <defs><marker id={arrowId} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#8b5cf6" /></marker></defs>
      {plan.edges.map((edge, index) => {
        const source = plan.stages.findIndex(stage => stage.id === edge.source);
        const target = plan.stages.findIndex(stage => stage.id === edge.target);
        if (source < 0 || target < 0) return null;
        const x1 = source * (columnWidth + 12) + columnWidth / 2, x2 = target * (columnWidth + 12) + columnWidth / 2;
        const y = 5 + index % 3 * 12;
        const path = source === target ? `M${x1 - 18},58 C${x1 - 85},${y} ${x1 + 85},${y} ${x1 + 18},58` : `M${x1},58 C${x1},${y} ${x2},${y} ${x2},58`;
        return <path key={`${edge.source}:${edge.target}:${index}`} d={path} fill="none" stroke="#8b5cf6" strokeWidth="1.5" vectorEffect="non-scaling-stroke" markerEnd={`url(#${arrowId})`}><title>{`${label(plan.stages[source])} → ${label(plan.stages[target])}`}</title></path>;
      })}
    </svg>}
    <ol aria-label="工作流阶段" className="grid gap-3" style={{gridTemplateColumns: `repeat(${Math.max(plan.stages.length, 1)}, ${columnWidth}px)`}}>
      {plan.stages.map((stage, index) => <li key={stage.id} data-stage-id={stage.id} className={`min-w-0 rounded-lg border p-3 ${stage.enabled ? 'border-violet-200 bg-violet-50' : 'border-slate-200 bg-slate-100'}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold"><span className="mr-2 text-xs text-violet-500">{String(index + 1).padStart(2, '0')}</span>{label(stage)}</h3><span className="text-[10px] text-slate-500">{status?.(stage) ?? (stage.enabled ? '计划阶段 · 未启动' : stage.placeholder ? '占位 · 未启用' : '未启用')}</span></div>
      </li>)}
    </ol>
  </div>;
}

export function WorkflowPlanPreview({ plan, entryTaskId, catalog }: {plan: WorkflowContext; entryTaskId?: string; catalog?: WorkflowNodeDefinition[]}) {
  const resolveInput = (resourceId: string | null, taskId: string | null) => resourceId
    ? plan.resources.find(resource => resource.id === resourceId)?.name ?? resourceId
    : (plan.tasks ?? []).find(task => task.id === taskId)?.name ?? taskId;
  return <div>
    <p className="mt-3 text-sm leading-6">{plan.goal}</p>
    <div className="mt-3 overflow-x-auto pb-2"><div style={{width: Math.max(plan.stages.length, 1) * 272}}><WorkflowStageRow plan={plan} catalog={catalog} /></div></div>
    <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">查看任务与资源详情</summary>
    {plan.edges.length > 0 && <p className="mt-2 text-xs text-slate-500">阶段依赖：{plan.edges.map(edge => `${plan.stages.find(stage => stage.id === edge.source)?.name ?? edge.source} → ${plan.stages.find(stage => stage.id === edge.target)?.name ?? edge.target}`).join('；')}</p>}
    {plan.resources.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2">{plan.resources.map(resource => <div key={resource.id} className="rounded border bg-slate-50 p-3 text-xs"><strong>{resource.name}</strong><p className="mt-1 break-all text-slate-500">{resource.uri ?? '地址待确定'}</p></div>)}</div>}
    {(plan.tasks ?? []).map(task => <details key={task.id} className="mt-3 rounded border p-3 text-xs"><summary className="cursor-pointer font-medium">任务详情 · {task.name}{task.id === entryTaskId ? ' · 首个启动任务' : ''}</summary>
      <div className="mt-2 space-y-2 text-slate-600">
        <p>{task.description}</p>
        {task.inputs.map(input => <p key={input.name}>输入 {input.name} ← {resolveInput(input.resource_id, input.task_id)}{input.output_name ? ` / ${input.output_name}` : ''}</p>)}
        {task.outputs.map(output => <p key={output.name}>产物 {output.name}：{output.description}</p>)}
        {(task.completion_conditions ?? []).map((condition, index) => <p key={index}>完成条件：{condition.description}</p>)}
      </div>
    </details>)}
    {!!plan.constraints?.length && <details className="mt-3 text-xs text-slate-600"><summary>执行约束</summary><ul className="mt-2 list-inside list-disc space-y-1">{plan.constraints.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
    </details>
  </div>;
}
