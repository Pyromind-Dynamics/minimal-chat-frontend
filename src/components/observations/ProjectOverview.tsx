import './ProjectOverview.css';
import { Fragment, useId, useState, type ReactNode } from 'react';
import type { RequestOptions } from '../../api';
import type { ObservationNode, ObservationOverview } from '../../observationsContract';
import type { ProductClient } from '../../productClient';
import type { ConversationSnapshot } from '../../types';
import { useObservationReport, useProjectObservations } from '../../hooks/useProjectObservations';
import {
  formatMetric,
  matchesObservationReportVersions,
  observationBusinessStatus,
  observationEvidenceVersion,
  observationHeadlineMetric,
  observationNodeStatus,
  observationStatusTone,
  trainingPanelBindings,
} from '../../observationsPresentation';
import { observationSections } from '../../observationForms';
import { ObservationFormSection } from './ObservationFormSection';

type Props = {
  client: ProductClient;
  projectId: string;
  snapshot?: ConversationSnapshot | null;
  options: RequestOptions;
  hidden?: boolean;
};
const modules = [
  { id: 'orchestrator', label: 'Orchestrator', stageType: 'init' },
  { id: 'tracer', label: 'Tracer', stageType: 'tracer' },
  { id: 'dataset', label: 'Dataset', stageType: 'dataset' },
  { id: 'train', label: 'Train', stageType: 'train' },
  { id: 'inference', label: 'Inference', stageType: 'inference' },
  { id: 'eval', label: 'Evaluation', stageType: 'eval' },
] as const;
type Module = typeof modules[number];

const stageSubjects: Record<Module['id'], string> = {
  orchestrator: '基线评估', tracer: 'Tracer', dataset: '数据准备',
  train: '训练', inference: '推理', eval: '评估',
};

const moduleIcons: Record<Module['id'], ReactNode> = {
  orchestrator: <path d="M16 6a7 7 0 0 0-12-1L2 7m0-4v4h4M4 14a7 7 0 0 0 12 1l2-2m0 4v-4h-4" />,
  tracer: <path d="M3 3h5v5H3zM12 12h5v5h-5zM8 5h6v7M5 8v6h7" />,
  dataset: <><ellipse cx="10" cy="4" rx="6" ry="2.5" /><path d="M4 4v11c0 3 12 3 12 0V4M4 9c0 3 12 3 12 0" /></>,
  train: <path d="M3 3v14h14M5 13l4-5 3 3 5-7" />,
  inference: <path d="M3 3h14v5H3zM3 12h14v5H3zM5 5h2M5 14h2M13 5h2M13 14h2" />,
  eval: <path d="m2 5 1.5 1.5L6 3M8 5h10M2 11h4M8 11h10M2 16h4M8 16h10" />,
};

function projectPhase(stages: ObservationOverview['nodes']): string {
  if (stages.length && stages.every(stage => stage.business_status === 'succeeded' && !stage.delivery_status)) return 'Completed';
  const active = stages.find(stage => stage.business_status === 'running' || stage.business_status === 'needs_input');
  const stage = active ?? stages.findLast(item => item.business_status !== 'queued');
  if (!stage) return 'Not started';
  if (stage.business_status === 'needs_input') return 'Confirmation';
  if (observationBusinessStatus(stage.business_status) === 'stopped') return 'Stopped';
  if (stage.type === 'train') return 'Training';
  if (stage.type === 'init') return 'Baseline';
  return modules.find(module => module.stageType === stage.type)?.label ?? 'In progress';
}

function moduleStatus(businessStatuses: string[]): string {
  const statuses = businessStatuses.map(status => status === 'waiting_analysis' ? 'waiting' : observationBusinessStatus(status));
  if (statuses.length && statuses.every(status => status === 'completed')) return 'completed';
  return ['failed', 'stopped', 'needs_input', 'running', 'waiting'].find(status => statuses.includes(status)) ?? 'pending';
}

function ModuleRow({ module, status, expanded, toggle, metric, children }: {
  module: Module; status?: string; expanded: boolean; toggle: () => void; metric: ReactNode; children: ReactNode;
}) {
  const id = useId();
  const label = status === 'needs_input' ? 'waiting' : status;
  const tone = label === 'waiting' ? 'warning' : observationStatusTone(label ?? '');
  return <section className="rsi-overview-item">
    <button type="button" aria-expanded={expanded} aria-controls={id} onClick={toggle}>
      <span className="rsi-overview-module">
        <svg className="rsi-preview-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">{moduleIcons[module.id]}</svg>
        <strong>{module.label}</strong>
        <svg className="rsi-preview-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 2 4 4-4 4" /></svg>
      </span>
      <span className={label ? `rsi-status rsi-status--${tone}` : 'rsi-status'}>{label ?? '—'}</span>
      <span className="rsi-overview-value">{metric}</span>
    </button>
    {expanded && <div id={id} className="rsi-module-body">{children}</div>}
  </section>;
}

function RegisteredReportMetric({ client, projectId, options, node }: {
  client: ProductClient; projectId: string; options: RequestOptions; node: ObservationNode;
}) {
  const versions = node.report_version_ids ?? [];
  const { report } = useObservationReport(client, projectId, { project_node_id: node.id }, versions, options);
  const metric = matchesObservationReportVersions(versions, report?.report_version_ids)
    ? observationHeadlineMetric(report?.metrics) : undefined;
  return <><strong>{formatMetric(metric?.value, metric?.unit)}</strong>{metric && <small>{metric.label}</small>}</>;
}

export function ProjectOverview({ hidden, inert, ...props }: Props & { inert?: boolean }) {
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 761px)').matches);
  return <aside className={`rsi-sidebar${open ? '' : ' is-collapsed'}`} aria-label="RSI Overview" hidden={hidden} inert={inert}>
    <header>
      <button type="button" className="rsi-sidebar-toggle" aria-label={open ? 'Collapse RSI Overview' : 'Expand RSI Overview'} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className="rsi-desktop-label">{open ? '⇥' : '⇤'}</span>
        <span className="rsi-mobile-label">{open ? 'Back to workspace' : 'RSI Overview'}</span>
      </button>
      {open && <h2>RSI Overview</h2>}
    </header>
    {open && <ProjectObservationContent key={props.projectId} {...props} />}
  </aside>;
}

function ProjectObservationContent({ client, projectId, snapshot, options }: Props) {
  const { overview, error, refresh } = useProjectObservations(client, projectId, options, observationEvidenceVersion(snapshot, projectId));
  const [expanded, setExpanded] = useState<Module['id'][]>([]);
  return <div className="rsi-toolbar project-observations">
    <div className="rsi-phase-row"><span>Project phase</span><strong>{overview ? projectPhase(overview.nodes) : '—'}</strong></div>
    <div className="rsi-expansion-actions">
      <button type="button" className="rsi-expand-all" onClick={() => setExpanded(items => items.length ? [] : modules.map(module => module.id))}>
        {expanded.length ? 'Collapse' : 'Expand'}
      </button>
    </div>
    {error && <p role="alert" className="observation-error">Unable to load project observations</p>}
    <div className="rsi-module-grid" aria-label="Module overview">
      <div className="rsi-overview-columns"><span>Module</span><span>Status</span><span>Key metric</span></div>
      {modules.map(module => {
        const stages = overview?.nodes.filter(stage => stage.type === module.stageType) ?? [];
        const details = stages.map(stage => {
          const status = overview ? observationNodeStatus(overview, stage, snapshot) : stage.business_status;
          const bindings = trainingPanelBindings(overview, stage.id);
          const reports = overview?.stage_analyses.filter(report => report.stage_id === stage.id) ?? [];
          const currentReport = reports.findLast(report => report.plan_sequence === overview?.plan_sequence &&
            stage.current_run_ids.length === report.run_ids.length && report.run_ids.every(runId => stage.current_run_ids.includes(runId)));
          return { stage, status, bindings, reports, currentReport };
        });
        const detail = details.length === 1 ? details[0] : undefined;
        const current = detail?.currentReport;
        const metric = current?.status === 'ready' ? observationHeadlineMetric(current.result?.metrics) : undefined;
        const status = overview ? moduleStatus(details.map(item => item.status)) : undefined;
        const runCount = new Set(details.flatMap(detail => detail.bindings.map(binding => binding.task_id))).size;
        let keyMetric = <><strong>{formatMetric(metric?.value, metric?.unit)}</strong>{metric && <small>{metric.label}</small>}</>;
        if (module.id === 'dataset' && stages.length) {
          keyMetric = <strong>{stages.length} {stages.length === 1 ? 'node' : 'nodes'}</strong>;
        } else if (module.id === 'train' && runCount) {
          keyMetric = <strong>{runCount} {runCount === 1 ? 'run' : 'runs'}</strong>;
        } else if ((module.id === 'orchestrator' || module.id === 'eval') && !metric &&
          status === 'completed' && detail?.stage.report_version_ids?.length) {
          keyMetric = <RegisteredReportMetric client={client} projectId={projectId} options={options} node={detail.stage} />;
        }
        const emptyMessage = error ? '暂时无法读取模块状态'
          : !overview ? '正在读取模块状态'
          : module.id === 'tracer' || module.id === 'inference' ? `${module.label} 资源接口尚未接入，暂无资源状态`
          : `当前计划没有${stageSubjects[module.id]}阶段`;
        return <ModuleRow key={module.id} module={module} status={status}
          expanded={expanded.includes(module.id)} metric={keyMetric} toggle={() => setExpanded(items =>
            items.includes(module.id) ? items.filter(item => item !== module.id) : [...items, module.id])}>
          {details.length && overview ? details.map(({ stage, status, bindings, reports, currentReport }) => {
            const panel = overview.config.panels.find(item => item.project_node_id === stage.id);
            const sections = observationSections(overview.config, stage.id, stage.type, module.label, stageSubjects[module.id]);
            return <Fragment key={stage.id}>
              {details.length > 1 && <h3>{stage.id}</h3>}
              {sections.map(section => <ObservationFormSection key={`${section.id}:${section.selection}`}
                section={section} node={stage} status={status} reports={reports} currentReport={currentReport}
                bindings={bindings} panel={panel} configVersion={overview.config_version}
                client={client} projectId={projectId} options={options} onDeliveryRetry={refresh} />)}
            </Fragment>;
          }) : <p role="status" className="rsi-detail-help">{emptyMessage}</p>}
        </ModuleRow>;
      })}
    </div>
  </div>;
}
