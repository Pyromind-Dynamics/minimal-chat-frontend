import './ProjectOverview.css';
import { useEffect, useId, useState, type ReactNode } from 'react';
import type { RequestOptions } from '../../api';
import type { ProductClient } from '../../productClient';
import type { ConversationSnapshot } from '../../types';
import type { ResourceStatus } from '../../observationsContract';
import { useProjectObservations } from '../../hooks/useProjectObservations';
import { formatMetric, observationBaseline, observationEvaluation, observationBusinessStatus, observationResourceStatus, observationStatusTone, observationProjectPhase, visibleTrainingPanels, observationMessage, observationEvidenceVersion, observationStageMessage, observationStageStatus, trainingPanelBindings } from '../../observationsPresentation';
import { BaselineReportHistory } from './BaselineReportHistory';
import { OrchestratorReadonly } from './OrchestratorReadonly';
import { ResourceStatusPanel } from './ResourceStatusPanel';
import { TrainingMetricPanel } from './TrainingMetricPanel';
import { DatasetResultPanel } from './DatasetResultPanel';
import { EvaluationMetricTable, EvaluationSummaryPanel } from './EvaluationSummaryPanel';
import { candidateEvaluationSummary, evaluationSummaryMetrics } from '../../evaluationSummary';

type ModuleId = 'Dataset' | 'Tracer' | 'Train' | 'Eval' | 'Inference' | 'Orchestrator';
const modules: ModuleId[] = ['Orchestrator', 'Tracer', 'Dataset', 'Train', 'Inference', 'Eval'];
type Props = { client: ProductClient; projectId: string | null; projectName?: string; snapshot?: ConversationSnapshot | null; options: RequestOptions };
type SidebarStatus = { phase: string; modules: Record<ModuleId, string> };
const sidebarStatusKey = 'rsi.sidebar-status.v1';

function readSidebarStatus(scope: string | null): SidebarStatus | null {
  if (!scope) return null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(sidebarStatusKey) ?? 'null');
    if (saved?.scope === scope && typeof saved.status?.phase === 'string' &&
        modules.every(kind => typeof saved.status.modules?.[kind] === 'string')) return saved.status;
  } catch { /* The sidebar also works when storage is unavailable. */ }
  return null;
}

function ModuleIcon({ kind }: { kind: ModuleId }) {
  const paths: Record<ModuleId, ReactNode> = {
    Dataset: <><ellipse cx="10" cy="4" rx="6" ry="2.5" /><path d="M4 4v11c0 3 12 3 12 0V4M4 9c0 3 12 3 12 0" /></>,
    Tracer: <><path d="M3 3h5v5H3zM12 12h5v5h-5zM8 5h6v7M5 8v6h7" /></>,
    Train: <><path d="M3 3v14h14M5 13l4-5 3 3 5-7" /></>,
    Eval: <><path d="m2 5 1.5 1.5L6 3M8 5h10M2 11h4M8 11h10M2 16h4M8 16h10" /></>,
    Inference: <><path d="M3 3h14v5H3zM3 12h14v5H3zM5 5h2M5 14h2M13 5h2M13 14h2" /></>,
    Orchestrator: <><path d="M16 6a7 7 0 0 0-12-1L2 7m0-4v4h4M4 14a7 7 0 0 0 12 1l2-2m0 4v-4h-4" /></>,
  };
  return <svg className="rsi-preview-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">{paths[kind]}</svg>;
}

function Status({ children }: { children: string }) {
  return <span className={`rsi-status rsi-status--${observationStatusTone(children)}`}>{children}</span>;
}
function ModuleRow({ kind, expanded, toggle, status, value, caption, children }: { kind: ModuleId; expanded: boolean; toggle: () => void; status?: string; value: string; caption?: string; children: ReactNode }) {
  const id = useId();
  return <section className="rsi-overview-item">
    <button type="button" aria-expanded={expanded} aria-controls={id} onClick={toggle}>
      <span className="rsi-overview-module"><ModuleIcon kind={kind} /><strong>{kind === 'Eval' ? 'Evaluation' : kind}</strong><svg className="rsi-preview-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 2 4 4-4 4" /></svg></span>
      {status ? <Status>{status}</Status> : <span className="rsi-status" aria-label="正在读取状态">—</span>}<span className="rsi-overview-value"><strong>{value}</strong>{caption && <small>{caption}</small>}</span>
    </button>
    {expanded && <div id={id} className="rsi-module-body">{children}</div>}
  </section>;
}

export function ProjectOverview(props: Props) {
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 761px)').matches);
  const [expanded, setExpanded] = useState<ModuleId[]>([]);
  return <aside className={`rsi-sidebar${open ? '' : ' is-collapsed'}`} aria-label="RSI Overview 侧栏">
    <header>
      <button type="button" className="rsi-sidebar-toggle" aria-label={open ? '收起 RSI Overview' : '展开 RSI Overview'} aria-expanded={open} onClick={() => setOpen(value => !value)}><span className="rsi-desktop-label">{open ? '⇥' : '⇤'}</span><span className="rsi-mobile-label">{open ? '返回对话' : 'RSI Overview'}</span></button>
      {open && <h2>RSI Overview</h2>}
    </header>
    {open && (props.projectId ? <ProjectObservationContent key={props.projectId} {...props} projectId={props.projectId} expanded={expanded} toggleAll={() => setExpanded(current => current.length ? [] : [...modules])} toggle={kind => setExpanded(current => current.includes(kind) ? current.filter(item => item !== kind) : [...current, kind])} /> : <div className="rsi-no-project"><p>选择 Project 后查看训练与评估结果</p><p>各模块按项目配置读取，无数据时保持空态</p></div>)}
  </aside>;
}

function ProjectObservationContent({ client, projectId, snapshot, options, expanded, toggle, toggleAll }: Props & { projectId: string; expanded: ModuleId[]; toggleAll: () => void; toggle: (kind: ModuleId) => void }) {
  const { overview, error } = useProjectObservations(client, projectId, options, observationEvidenceVersion(snapshot, projectId));
  const dataset = overview?.nodes.filter(node => node.type === 'dataset') ?? (snapshot?.project?.project_id === projectId ? snapshot.project.plan.stages.filter(stage => stage.kind === 'dataset') : []);
  const panels = visibleTrainingPanels(overview);
  const reportedTrainingRuns = snapshot?.experiment_executions?.filter(run =>
    run.project_id === projectId && run.report_state === 'ready',
  ) ?? [];
  const trainingPanels = overview && panels.map(panel => {
    const reportedTaskIds = reportedTrainingRuns
      .filter(run => run.stage_id === panel.project_node_id)
      .flatMap(run => [run.platform_task_id, ...(run.platform_task_ids ?? [])].filter(id => id !== null));
    return <TrainingMetricPanel
      key={`${projectId}:${overview.config_version}:${panel.project_node_id}`}
      client={client}
      projectId={projectId}
      panel={panel}
      bindings={trainingPanelBindings(overview, panel.project_node_id)}
      configVersion={overview.config_version}
      options={options}
      reportedTaskIds={reportedTaskIds}
    />;
  });
  const trainingRuns = new Set([
    ...(overview?.available_runs.filter(run => overview.nodes.some(node => node.type === 'train' && node.id === run.project_node_id)) ?? []),
    ...(overview?.bindings ?? []),
  ].map(run => run.run_id));
  const resource = (kind: ResourceStatus['kind']) => overview?.resources.find(item => item.kind === kind);
  const baseline = observationBaseline(snapshot, projectId);
  const baselineStatus = observationBusinessStatus(baseline?.state);
  const baselineReport = baseline && overview?.baseline &&
    overview.baseline.project_node_id === baseline.stage_id &&
    [baseline.platform_task_id, ...(baseline.platform_task_ids ?? [])].includes(overview.baseline.task_id)
    ? overview.baseline : null;
  const baselineTaskIds = overview?.baseline_report_task_ids ?? [];
  const baselineTaskId = baselineReport?.task_id ?? baseline?.platform_task_id;
  const baselineMetric = baselineReport?.observation_status === 'available' ? evaluationSummaryMetrics(baselineReport.metrics).summary.find(metric => metric.key === 'pass_rate') : undefined;
  const evaluation = observationEvaluation(snapshot, projectId, overview?.evaluation?.task_id);
  const candidateReport = overview?.evaluation && evaluation && [evaluation.platform_task_id, ...(evaluation.platform_task_ids ?? [])].includes(overview.evaluation.task_id) ? overview.evaluation : null;
  const candidate = candidateEvaluationSummary(candidateReport, overview?.latest_evaluation, overview?.latest_evaluation_metrics);
  const evalStatus = observationStageStatus(overview, snapshot, projectId, 'eval');
  const currentEvaluation = observationEvaluation(snapshot, projectId);
  const scoringCompleted = snapshot?.external_tasks?.some(task =>
    task.task_id === currentEvaluation?.platform_task_id && task.status === 'succeeded');
  const orchestrator = resource('orchestrator');
  const statusScope = snapshot?.project?.project_id === projectId
    ? JSON.stringify([options.userId, options.xCluster, projectId, snapshot.conversation_id, snapshot.through_seq])
    : null;
  const verifiedStatus: SidebarStatus | null = overview ? {
    phase: observationProjectPhase(overview, snapshot, projectId),
    modules: {
      Orchestrator: baseline && (!orchestrator || orchestrator.observation_status === 'not_configured') ? baselineStatus : observationResourceStatus(orchestrator),
      Tracer: observationResourceStatus(resource('tracer')),
      Dataset: observationStageStatus(overview, snapshot, projectId, 'dataset'),
      Train: observationStageStatus(overview, snapshot, projectId, 'train'),
      Inference: observationResourceStatus(resource('inference')),
      Eval: evalStatus,
    },
  } : null;
  const savedStatus = statusScope && verifiedStatus ? JSON.stringify({ scope: statusScope, status: verifiedStatus }) : null;
  useEffect(() => {
    if (!savedStatus) return;
    try {
      sessionStorage.setItem(sidebarStatusKey, savedStatus);
    } catch { /* Status remains available from the overview without storage. */ }
  }, [savedStatus]);
  const status = verifiedStatus ?? (error ? null : readSidebarStatus(statusScope));
  const unreadState = error ? 'unavailable' : undefined;
  const resourcePlaceholder = <p className="rsi-detail-help" role="status">{error ? '资源状态暂不可用' : '正在读取资源状态'}</p>;
  const trainMessage = observationStageMessage('train', status?.modules.Train ?? unreadState);
  let evaluationMessage = observationStageMessage('eval', status?.modules.Eval ?? unreadState);
  if (status?.modules.Eval === 'running' && scoringCompleted) {
    const currentReport = candidateReport?.task_id === currentEvaluation?.platform_task_id ? candidateReport : null;
    evaluationMessage = observationMessage(currentReport?.message) || '评分已结束，等待评估结果登记';
  }
  const baselineReason = observationMessage(baseline?.waiting_reason);
  const baselineMessage = ['paused', 'stopped'].includes(baselineStatus)
    ? observationStageMessage('baseline', baselineStatus)
    : baselineReason || observationStageMessage('baseline', baselineStatus);
  function row(kind: ModuleId, value: string, caption: string, children: ReactNode) {
    return <ModuleRow key={kind} kind={kind} status={status?.modules[kind]} value={value} caption={caption} expanded={expanded.includes(kind)} toggle={() => toggle(kind)}>{children}</ModuleRow>;
  }
  return <>
    <div className="rsi-toolbar project-observations">
      <div className="rsi-phase-row"><span>Project phase</span><strong>{status?.phase ?? '—'}</strong></div>
      <div className="rsi-expansion-actions"><button type="button" className="rsi-expand-all" onClick={toggleAll}>{expanded.length ? '收起' : '展开'}</button></div>
      {error && <p role="alert" className="observation-error">{observationMessage(error)}</p>}
      <div className="rsi-module-grid" aria-label="Module overview">
        <div className="rsi-overview-columns"><span>Module</span><span>Status</span><span>Key metric</span></div>
        {row('Orchestrator', baselineMetric ? formatMetric(baselineMetric.value, baselineMetric.unit) : '—', baselineMetric?.label ?? '', <>
          {(baseline || baselineTaskIds.length > 0) && <BaselineReportHistory
            client={client} projectId={projectId} options={options} taskIds={baselineTaskIds}
            currentTaskId={baselineTaskId}
            current={baseline && <>
              <dl className="observation-facts"><dt>基线任务</dt><dd>{baseline.task_name}</dd><dt>平台任务</dt><dd>{baselineTaskId ?? '尚未提交'}</dd>{baselineReport?.model_reference && <><dt>基线模型</dt><dd>{baselineReport.model_reference}</dd></>}</dl>
              {baselineReport && (baselineReport.observation_status === 'available' || baselineStatus === 'completed')
                ? <EvaluationSummaryPanel report={baselineReport} />
                : <p className="rsi-detail-help" role="status">{baselineMessage}</p>}
            </>}
          />}
          {((!baseline && !baselineTaskIds.length) || (orchestrator && orchestrator.observation_status !== 'not_configured')) && (overview ? <OrchestratorReadonly resource={orchestrator} /> : resourcePlaceholder)}
        </>)}
        {row('Tracer', '—', '', overview ? <ResourceStatusPanel kind="tracer" resource={resource('tracer')} /> : resourcePlaceholder)}
        {row('Dataset', dataset.length ? `${dataset.length} 个节点` : '—', '', dataset.length ? dataset.map(node => <DatasetResultPanel key={node.id} snapshot={snapshot} projectId={projectId} nodeId={node.id} status={observationStageStatus(overview, snapshot, projectId, 'dataset', node.id)} client={client} options={options} />) : <p className="rsi-detail-help" role="status">{overview ? '暂无数据节点' : observationStageMessage('dataset', unreadState)}</p>)}
        {row('Train', trainingRuns.size ? `${trainingRuns.size} 个运行` : '—', '', trainingPanels?.length ? trainingPanels : <p className="rsi-detail-help" role="status">{trainMessage}</p>)}
        {row('Inference', '—', '', overview ? <ResourceStatusPanel kind="inference" resource={resource('inference')} /> : resourcePlaceholder)}
        {row('Eval', candidate.primary ? formatMetric(candidate.primary.value, candidate.primary.unit) : '—', candidate.primary?.label ?? '', candidate.rows.length > 0
          ? <EvaluationMetricTable rows={candidate.rows} label="候选评估结果" />
          : <p className="rsi-detail-help" role="status">{evaluationMessage}</p>)}
      </div>
    </div>
  </>;
}
