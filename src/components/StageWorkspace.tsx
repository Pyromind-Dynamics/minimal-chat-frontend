import type { ConversationSnapshot } from '../types';
import type { RequestOptions } from '../api';
import { useState } from 'react';
import { executionProgressLabel } from '../experimentExecutions';
import { stageOperations } from '../preparation';
import { StageAgentConversation } from './StageAgentConversation';
import { WorkflowStageRow } from './WorkflowPlanPreview';
export function StageWorkspace({ snapshot, requestOptions = {} }: {
  snapshot: ConversationSnapshot; requestOptions?: RequestOptions;
}) {
  const [selectedRuns, setSelectedRuns] = useState<Record<string, string>>({});
  const [stageRunExpanded, setStageRunExpanded] = useState(false);
  const project = snapshot.project;
  if (!project) return null;
  const executions = snapshot.experiment_executions ?? [];
  const known = new Set(project.plan.stages.map(stage => stage.id));
  const historical = executions.filter(run => run.stage_id && !known.has(run.stage_id) && run.stage_snapshot)
    .filter((run, index, all) => all.findIndex(other => other.stage_id === run.stage_id) === index)
    .map(run => ({ id: run.stage_id!, kind: run.stage_snapshot!.kind, name: run.stage_snapshot!.name, description: '历史阶段', enabled: false, placeholder: false }));
  const stages = [...project.plan.stages, ...historical];
  const stageWidth = 360;
  const columns = { gridTemplateColumns: `repeat(${Math.max(stages.length, 1)}, ${stageWidth}px)`, width: 'max-content' };
  return <section aria-label="阶段工作台" className="flex max-h-[55vh] shrink-0 flex-col border-b-4 border-slate-300 bg-slate-100">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-100 px-4 py-3">
      <div className="flex items-center gap-3"><span className="rounded bg-slate-800 px-2 py-1 text-xs font-semibold text-white">State</span><h2 className="font-semibold">workflowPLAN · 阶段状态</h2><button type="button" aria-expanded={stageRunExpanded} onClick={() => setStageRunExpanded(value => !value)} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">{stageRunExpanded ? '收起阶段状态' : '展开阶段状态'}</button><span className="text-xs text-slate-500">{stages.length} 个阶段</span></div>
      <span className="rounded-full border bg-white px-2 py-1 font-mono text-[10px] text-slate-500" title={project.project_id}>Project {project.project_id.slice(0, 12)}</span>
    </header>
    <div hidden={!stageRunExpanded} className="stage-workspace-body min-h-0 overflow-auto p-4">
    <p className="mt-1 text-xs text-slate-600">{project.plan.goal}</p>
    {project.plan.edges.length > 0 && <p className="mt-2 text-xs text-slate-500">{project.plan.edges.map(edge => `${stages.find(stage => stage.id === edge.source)?.name ?? edge.source} → ${stages.find(stage => stage.id === edge.target)?.name ?? edge.target}`).join('；')}</p>}
    <div className="mt-4 min-w-fit">
    <WorkflowStageRow plan={{...project.plan, stages}} columnWidth={stageWidth} catalog={snapshot.preparation?.policy.workflow_nodes} status={stage => {
        const runs = executions.filter(run => run.stage_id === stage.id);
        const latest = runs.at(-1);
        return historical.some(item => item.id === stage.id) ? '历史阶段' : !stage.enabled ? '未启用' : latest ? executionProgressLabel(latest) : '待执行';
      }} />
    <div className="mt-3 grid items-start gap-3" style={columns}>
      {stages.map(stage => {
        const runs = executions.filter(run => run.stage_id === stage.id);
        const selectionKey = `${project.project_id}:${stage.id}`;
        const selected = runs.find(run => run.run_id === selectedRuns[selectionKey]) ?? runs.at(-1);
        const operations = stageOperations(snapshot, stage.id).filter(operation => !selected || operation.execution?.task_run_id === selected.run_id);
        return <section key={stage.id} data-stage-id={stage.id} aria-label={`阶段 ${stage.name}`} className="min-w-0 overflow-hidden break-words rounded-lg border bg-white p-3">
          {runs.length === 0 && <p className="my-6 text-center text-xs text-slate-400">{stage.enabled ? '尚未执行' : '此阶段未启用'}</p>}
          {runs.length > 1 && <label className="mt-3 block text-xs text-slate-500">执行历史
            <select aria-label={`${stage.name} 的执行记录`} value={selected?.run_id} onChange={event => setSelectedRuns(current => ({...current, [selectionKey]: event.target.value}))} className="mt-1 block w-full rounded border bg-white p-2 text-xs text-slate-700">
              {runs.map((run, index) => <option key={run.run_id} value={run.run_id}>第 {index + 1} 次 · {run.task_name} · {executionProgressLabel(run)}</option>)}
            </select>
          </label>}
          {selected?.waiting_reason && <p role={selected.report_state === 'failed' ? 'alert' : 'status'} className="mt-2 break-words whitespace-pre-wrap text-xs text-amber-800">{selected.waiting_reason}</p>}
          {(selected || operations.length > 0) && <StageAgentConversation key={selected?.run_id ?? selectionKey} operations={operations} requestOptions={requestOptions} status={selected ? executionProgressLabel(selected) : undefined} />}
        </section>;
      })}
    </div>
    </div>
    </div>
  </section>;
}
