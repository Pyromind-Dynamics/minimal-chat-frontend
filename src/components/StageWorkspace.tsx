import { useState } from 'react';
import type { ConversationSnapshot } from '../types';
import { executionProgressLabel, type ExperimentExecution } from '../experimentExecutions';
import { stageOperations } from '../preparation';
import { WorkflowStageRow } from './WorkflowPlanPreview';

const BASELINE_ANALYSIS_TITLE = '基线解读与 badcase 归因';

function baselineAnalysisTurnStatus(snapshot: ConversationSnapshot, taskId: string): string | undefined {
  const command = `project-continue:${snapshot.project?.project_id}:${taskId}`;
  if (snapshot.experiment_queue?.some(task => task.task_id === command)) return '排队中';
  const activeRunId = snapshot.active_run_id;
  if (snapshot.status === 'running' && activeRunId && (
    snapshot.task_runs?.[activeRunId]?.task_id === command ||
    snapshot.timeline.some(item => 'run_id' in item && item.run_id === activeRunId && item.task_id === command)
  )) return '正在分析';
  const latestTask = snapshot.timeline.findLast(item => item.task_id)?.task_id;
  return snapshot.status === 'paused' && latestTask === command ? '已暂停' : undefined;
}

function statusLabel(run: ExperimentExecution) {
  if (run.report_evidence_key && run.state === 'succeeded') return '执行已完成';
  if (run.report_required || run.state === 'waiting_analysis') return executionProgressLabel(run);
  return run.state === 'succeeded' || run.state === 'reported' ? '已完成' : executionProgressLabel(run);
}

function deliveryLabel(run: ExperimentExecution) {
  if (run.state !== 'succeeded' && run.state !== 'reported' && run.state !== 'waiting_analysis') return null;
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

export function StageWorkspace({ snapshot, onOpenRuntime }: {
  snapshot: ConversationSnapshot; onOpenRuntime?: () => void;
}) {
  const [selectedRuns, setSelectedRuns] = useState<Record<string, string>>({});
  const project = snapshot.project;
  if (!project) return null;
  const executions = snapshot.experiment_executions ?? [];
  const catalog = snapshot.preparation?.policy.workflow_nodes;
  const known = new Set(project.plan.stages.map(stage => stage.id));
  const historical = executions.filter(run => run.stage_id && !known.has(run.stage_id) && run.stage_snapshot)
    .filter((run, index, all) => all.findIndex(other => other.stage_id === run.stage_id) === index)
    .map(run => ({ id: run.stage_id!, kind: run.stage_snapshot!.kind, name: run.stage_snapshot!.name, description: '历史阶段', enabled: false, placeholder: false }));
  const stages = [...project.plan.stages, ...historical];
  const stageActivity = new Map(stages.map(stage => {
    const tasks = (project.plan.tasks ?? []).filter(task => task.stage_id === stage.id);
    const separateAnalysis = stage.kind === 'init' || executions.some(run => run.stage_id === stage.id && run.report_evidence_key);
    const analysisTasks = separateAnalysis ? tasks.filter(task => task.kind === 'analysis') : [];
    const analysisTaskIds = new Set(analysisTasks.map(task => task.id));
    const stageRuns = executions.filter(run => run.stage_id === stage.id);
    const runs = stageRuns.filter(run => !analysisTaskIds.has(run.task_id));
    const operations = stageOperations(snapshot, stage.id);
    const lastActivity = new Map<string, number>();
    for (const operation of operations) {
      const runId = operation.execution!.task_run_id;
      const seq = operation.completed_seq ?? operation.started_seq;
      lastActivity.set(runId, Math.max(lastActivity.get(runId) ?? 0, seq));
    }
    const matchingPlan = runs.filter(run => run.plan_sequence == null || run.plan_sequence === project.plan_sequence);
    const currentRuns = matchingPlan.filter(run => run.plan_attempt == null || !matchingPlan.some(other =>
      other.task_id === run.task_id && (other.plan_attempt ?? 1) > run.plan_attempt!));
    const last = currentRuns.at(-1) ?? runs.at(-1);
    // A newly queued execution may not have produced any agent activity yet.
    const latest = last && lastActivity.has(last.run_id)
      ? currentRuns.reduce((current, run) =>
        (lastActivity.get(run.run_id) ?? -1) > (lastActivity.get(current.run_id) ?? -1) ? run : current, last)
      : last;
    const byTask = new Map<string, typeof runs>();
    for (const run of runs) {
      const attempts = byTask.get(run.task_id) ?? [];
      attempts.push(run);
      byTask.set(run.task_id, attempts);
    }
    const planned = tasks.filter(task => !analysisTaskIds.has(task.id));
    const current = planned.map(task => currentRuns.filter(run => run.task_id === task.id)
      .sort((a, b) => (a.plan_attempt ?? 1) - (b.plan_attempt ?? 1)).at(-1));
    const isComplete = (run?: ExperimentExecution) => run?.state === 'succeeded' || run?.state === 'reported';
    const unfinished = current.find(run => run && !isComplete(run));
    const pendingDelivery = current.find(run => run?.report_required &&
      isComplete(run) && run.report_state !== 'ready');
    const executionRuns = current.filter((_, index) => planned[index].kind !== 'analysis');
    const waitingForAnalysis = !pendingDelivery && executionRuns.length > 0 && executionRuns.every(isComplete) &&
      executionRuns.some(run => run?.report_state === 'ready') && current.some((run, index) =>
        planned[index].kind === 'analysis' && (!run || ['queued', 'preparing', 'analyzing', 'waiting_analysis'].includes(run.state)));
    let status = latest ? statusLabel(latest) : '待执行';
    if (planned.length > 1 && latest) {
      if (waitingForAnalysis) status = '报告已交付 · 等待阶段分析';
      else if (unfinished) status = statusLabel(unfinished);
      else if (pendingDelivery) status = statusLabel(pendingDelivery);
      else if (current.some(run => !run)) status = '部分完成';
    }
    const analysis = analysisTasks.map(task => {
      const run = stageRuns.filter(run => run.task_id === task.id && run.plan_sequence === project.plan_sequence)
        .sort((a, b) => (a.plan_attempt ?? 1) - (b.plan_attempt ?? 1)).at(-1);
      const blocked = run && ['failed', 'cancelled', 'needs_input'].includes(run.state);
      const requiresReport = run?.report_required || task.outputs?.some(output => output.kind === 'report');
      const registered = run?.report_state === 'ready' && run.artifacts?.some(item => item.artifact_id);
      const awaitingReport = requiresReport && !registered;
      const delivery = run && (awaitingReport && (run.report_state === 'ready' || run.report_state === 'not_started')
        ? '待校验登记' : deliveryLabel(run));
      const label = blocked ? statusLabel(run) : delivery
        ?? baselineAnalysisTurnStatus(snapshot, task.id) ?? (run ? statusLabel(run) : '待执行');
      return {id: task.id, title: stage.kind === 'init' && analysisTasks.length === 1 ? BASELINE_ANALYSIS_TITLE : task.name,
        label, awaitingReport, failed: blocked || run?.report_state === 'registration_failed' || run?.report_state === 'failed'};
    });
    if (executionRuns.length && executionRuns.every(isComplete) && !pendingDelivery) {
      const outstanding = analysis.filter(item => item.awaitingReport);
      if (outstanding.length) status = outstanding.find(item => item.failed)?.label ?? '报告已交付 · 等待阶段分析';
    }
    return [stage.id, { runs, latest, byTask, status, analysis }];
  }));
  const stageWidth = 360;
  const columns = { gridTemplateColumns: `repeat(${stages.length}, ${stageWidth}px)` };
  return <section aria-label="阶段工作台" className="min-w-0 shrink-0 px-4 py-4 sm:px-5">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2>workflowPLAN · 阶段状态</h2>
        {onOpenRuntime && <button type="button" onClick={onOpenRuntime} className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white">调试与发布</button>}
        <span className="text-xs text-slate-500">{stages.length} 个阶段</span>
      </div>
      <span className="font-mono text-xs text-slate-500" title={project.project_id}>Project {project.project_id.slice(0, 12)}</span>
    </header>
    {stages.length > 0 && <div role="region" aria-label="工作流阶段与执行详情" tabIndex={0}
      className="stage-workspace-track mt-2 overflow-x-auto pb-3">
      <WorkflowStageRow plan={{...project.plan, stages}} columnWidth={stageWidth} catalog={catalog}
        status={stage => !known.has(stage.id) ? '历史阶段'
          : !stage.enabled ? '未启用' : stageActivity.get(stage.id)!.status} />
      <div className="mt-3 grid w-max items-start gap-3" style={columns}>
        {stages.map(stage => {
          const { runs, latest, byTask, analysis } = stageActivity.get(stage.id)!;
          const selectionKey = `${project.project_id}:${stage.id}`;
          const selected = runs.find(run => run.run_id === selectedRuns[selectionKey]) ?? latest;
          const delivery = selected && deliveryLabel(selected);
          return <div key={stage.id} className="grid min-w-0 gap-2">
            <section data-stage-id={stage.id} aria-label={`阶段 ${stage.name}`}
              className="min-w-0 break-words rounded-lg border bg-white p-3">
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
              {delivery && <p className="mt-1 text-xs text-slate-500">{selected?.report_evidence_key && 'Subagent · '}{delivery}</p>}
              {selected?.waiting_reason && <p role={selected.report_state === 'failed' ? 'alert' : 'status'} className="mt-2 break-words whitespace-pre-wrap text-xs text-amber-800">{selected.waiting_reason}</p>}
            </section>
            {stage.enabled && analysis.map(task => <div key={task.id}
              className="flex items-baseline justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <span className="min-w-0 text-slate-700">{task.title}</span>
              <span className="shrink-0 text-slate-500">{task.label}</span>
            </div>)}
          </div>;
        })}
      </div>
    </div>}
  </section>;
}
