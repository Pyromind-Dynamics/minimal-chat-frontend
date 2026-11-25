import { useState } from 'react';
import type { ConversationSnapshot } from '../types';
import { executionProgressLabel, type ExperimentExecution } from '../experimentExecutions';
import { stageOperations } from '../preparation';
import { WorkflowStageRow } from './WorkflowPlanPreview';

function statusLabel(run: ExperimentExecution) {
  return run.state === 'succeeded' || run.state === 'reported' ? '已完成' : executionProgressLabel(run);
}

function deliveryLabel(run: ExperimentExecution) {
  if (run.state !== 'succeeded' && run.state !== 'reported') return null;
  switch (run.report_state) {
    case 'ready': return '报告已就绪';
    case 'registering': return '正在登记产物';
    case 'registration_failed': return '产物登记失败';
    case 'failed': return '报告生成失败';
    case 'not_started': return null;
    case 'queued': return '等待生成报告';
    case 'running': return '正在生成报告';
    default: return `报告状态：${run.report_state}`;
  }
}

export function StageWorkspace({ snapshot }: {snapshot: ConversationSnapshot}) {
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
  const stageActivity = new Map(stages.map(stage => {
    const runs = executions.filter(run => run.stage_id === stage.id);
    const operations = stageOperations(snapshot, stage.id);
    const lastActivity = new Map<string, number>();
    for (const operation of operations) {
      const runId = operation.execution!.task_run_id;
      const seq = operation.completed_seq ?? operation.started_seq;
      lastActivity.set(runId, Math.max(lastActivity.get(runId) ?? 0, seq));
    }
    const last = runs.at(-1);
    // A newly queued execution may not have produced any agent activity yet.
    const latest = last && lastActivity.has(last.run_id)
      ? runs.reduce((current, run) =>
        (lastActivity.get(run.run_id) ?? -1) > (lastActivity.get(current.run_id) ?? -1) ? run : current, last)
      : last;
    const byTask = new Map<string, typeof runs>();
    for (const run of runs) {
      const attempts = byTask.get(run.task_id) ?? [];
      attempts.push(run);
      byTask.set(run.task_id, attempts);
    }
    const planned = (project.plan.tasks ?? []).filter(task => task.stage_id === stage.id);
    const current = planned.map(task => byTask.get(task.id)?.at(-1));
    const unfinished = current.find(run => run && run.state !== 'succeeded' && run.state !== 'reported');
    let status = latest ? statusLabel(latest) : '待执行';
    if (planned.length > 1 && latest) {
      if (unfinished) status = statusLabel(unfinished);
      else if (current.some(run => !run)) status = '部分完成';
    }
    return [stage.id, { runs, latest, byTask, status }];
  }));
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
        const { status } = stageActivity.get(stage.id)!;
        return historical.some(item => item.id === stage.id) ? '历史阶段' : !stage.enabled ? '未启用' : status;
      }} />
    <div className="mt-3 grid items-start gap-3" style={columns}>
      {stages.map(stage => {
        const { runs, latest, byTask } = stageActivity.get(stage.id)!;
        const selectionKey = `${project.project_id}:${stage.id}`;
        const selected = runs.find(run => run.run_id === selectedRuns[selectionKey]) ?? latest;
        const delivery = selected && deliveryLabel(selected);
        return <section key={stage.id} data-stage-id={stage.id} aria-label={`阶段 ${stage.name}`} className="min-w-0 overflow-hidden break-words rounded-lg border bg-white p-3">
          {runs.length === 0 && <p className="my-6 text-center text-xs text-slate-400">{stage.enabled ? '尚未执行' : '此阶段未启用'}</p>}
          {runs.length === 1 && selected && <p className="text-xs text-slate-700">{selected.task_name} · {statusLabel(selected)}</p>}
          {runs.length > 1 && <label className="mt-3 block text-xs text-slate-500">执行历史
            <select aria-label={`${stage.name} 的执行记录`} value={selected?.run_id} onChange={event => setSelectedRuns(current => ({...current, [selectionKey]: event.target.value}))} className="mt-1 block w-full rounded border bg-white p-2 text-xs text-slate-700">
              {runs.map(run => {
                const attempts = byTask.get(run.task_id)!;
                const attempt = attempts.length > 1 ? `第 ${attempts.indexOf(run) + 1} 次 · ` : '';
                return <option key={run.run_id} value={run.run_id}>{attempt}{run.task_name} · {statusLabel(run)}</option>;
              })}
            </select>
          </label>}
          {selected?.platform_task_id && <p className="mt-1 text-xs text-slate-500">Studio 任务 #{selected.platform_task_id}</p>}
          {delivery && <p className="mt-1 text-xs text-slate-500">{delivery}</p>}
          {selected?.waiting_reason && <p role={selected.report_state === 'failed' ? 'alert' : 'status'} className="mt-2 break-words whitespace-pre-wrap text-xs text-amber-800">{selected.waiting_reason}</p>}
        </section>;
      })}
    </div>
    </div>
    </div>
  </section>;
}
