import type { ReactNode } from 'react';
import {
  graphRunStatusLabel,
  isRecord,
  pendingArtifactVerificationTask,
  stageRunStatusLabel,
  type GraphRun,
  type GraphRunDetail,
  type StageRun,
} from '../echomindRuntime';
import { collectionSimulationStatus, type CollectionSimulation } from '../echomindResources';

const STAGES = [
  ['dataset', 'Dataset'],
  ['train', 'Train'],
  ['evaluator', 'Eval'],
] as const;

const TONE = {
  idle: 'border-slate-200 bg-slate-50 text-slate-600',
  active: 'border-blue-200 bg-blue-50 text-blue-800',
  waiting: 'border-amber-200 bg-amber-50 text-amber-900',
  complete: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-red-200 bg-red-50 text-red-800',
};

interface Step {
  title: string;
  label: string;
  tone: keyof typeof TONE;
  current?: boolean;
  message?: string | null;
  taskIds?: string[];
}

function collectionStep(run: GraphRun | undefined, simulation: CollectionSimulation | null): Step {
  const source = run?.inputs.tracer_batch;
  const fromTracer = isRecord(source) && typeof source.batch_id === 'string' && source.batch_id.trim()
    && typeof source.resource_id === 'string' && source.resource_id.trim() ? source.batch_id : undefined;
  const batchId = run?.source_batch_id
    || fromTracer;
  if (run) {
    return batchId || (run.trigger === 'tracer_batch' && run.source_tracer_resource_id)
      ? { title: '轨迹采集', label: '已封批', tone: 'complete', message: batchId }
      : { title: '轨迹采集', label: '使用运行输入', tone: 'idle' };
  }
  if (!simulation) return { title: '轨迹采集', label: '待采集', tone: 'idle' };
  if (simulation.batch_ids.length) {
    const blocked = simulation.status === 'paused' || simulation.status === 'failed';
    return {
      title: '轨迹采集',
      label: blocked ? `已封批 · ${collectionSimulationStatus(simulation)}` : '已封批',
      tone: simulation.status === 'failed' ? 'error' : blocked ? 'waiting' : 'complete',
      current: blocked,
      message: [simulation.batch_ids.join('、'), simulation.error].filter(Boolean).join(' · '),
    };
  }
  return {
    title: '轨迹采集',
    label: collectionSimulationStatus(simulation),
    tone: simulation.status === 'failed' ? 'error' : simulation.status === 'feeding' ? 'active' : 'waiting',
    current: true,
    message: simulation.error || `${simulation.completed_samples}/${simulation.requested_samples} 条`,
  };
}

function stageStep(
  title: string,
  stage: StageRun | undefined,
  run: GraphRun | undefined,
  verifyingStageId: string | undefined,
): Step {
  if (!stage) {
    const stopped = run?.status === 'failed' || run?.status === 'canceled';
    return { title, label: stopped ? '未执行' : '待执行', tone: 'idle' };
  }
  const step: Step = {
    title,
    label: stageRunStatusLabel(stage.status),
    tone: 'idle',
    current: run?.current_stage_ids.includes(stage.run_id),
    taskIds: [...new Set(stage.task_runs.flatMap(task => task.provider_run_id ? [task.provider_run_id] : []))],
  };
  if (stage.status === 'succeeded') step.tone = 'complete';
  if (stage.status === 'running' || stage.status === 'clarifying') step.tone = 'active';
  if (stage.status === 'failed') {
    step.tone = 'error';
    step.message = stage.error || stage.task_runs.find(task => task.error)?.error || stage.message;
  }
  if (stage.status === 'waiting_user' || stage.status === 'paused' || stage.status === 'waiting_external') {
    step.tone = 'waiting';
    step.message = stage.error || stage.message;
  }
  if (stage.status === 'waiting_external') {
    if (stage.run_id === verifyingStageId) {
      step.label = '等待校验产物';
      step.message ||= '平台回调已成功';
    } else if (stage.task_runs.some(task => (task.provider_reported_status ?? task.status) === 'running')) {
      step.label = '平台执行中';
      step.tone = 'active';
    } else if (stage.task_runs.some(task => task.provider_reported_status === 'pending')) {
      step.label = '平台排队中';
    } else if (stage.task_runs.some(task => task.status === 'submitted')) {
      step.label = '已提交平台';
    }
  }
  return step;
}

function resultStep(run: GraphRun | undefined, stages: Step[]): Step {
  const title = '本轮结果';
  if (run?.status === 'succeeded') {
    const message = run.outcome === 'candidate_recorded'
      ? '模型与评测报告已归档，由你选择是否上线'
      : run.promotion_result.reason === 'finalizer_not_configured'
        ? '保留当前线上模型，未配置自动切换'
      : run.outcome === 'baseline_retained' ? '保留当前线上模型'
        : run.outcome === 'promoted' ? '采用候选模型' : undefined;
    return { title, label: '已完成', tone: 'complete', message };
  }
  if (run?.status === 'failed') return { title, label: '失败', tone: 'error' };
  if (run?.status === 'canceled') return { title, label: '已取消', tone: 'idle' };
  if (run?.status === 'paused' && stages.every(stage => !stage.current)) {
    return { title, label: '已暂停', tone: 'waiting', current: true };
  }
  if (run?.status === 'running' && stages.every(stage => stage.tone === 'complete')) {
    return { title, label: '正在处理结果', tone: 'active', current: true };
  }
  return { title, label: '待完成', tone: 'idle' };
}

function FlywheelProgress({ run, simulation, processing, detail, detailError }: {
  run?: GraphRun;
  simulation: CollectionSimulation | null;
  processing: Step[];
  detail?: GraphRunDetail;
  detailError?: string;
}) {
  if (run && !detail) return <p role="status" className="mt-3 text-xs text-slate-600">
    {detailError ? `本轮节点状态读取失败。${detailError}` : '正在读取本轮节点状态…'}
  </p>;
  let total: number, completed: number, summary: string;
  if (run) {
    total = processing.length;
    completed = processing.filter(step => step.tone === 'complete').length;
    const active = processing.filter(step => step.current || step.tone === 'error');
    const status = active.map(step => {
      const tasks = step.taskIds?.length ? ` · 平台任务 ${step.taskIds.join('、')}` : '';
      return `${step.title} ${step.label}${tasks}`;
    }).join('、') || graphRunStatusLabel(run.status);
    summary = `已完成 ${completed}/${total} 个执行节点 · ${status}`;
  } else if (simulation) {
    total = simulation.requested_samples;
    completed = simulation.completed_samples;
    summary = `已采集 ${completed}/${total} 条 · ${collectionSimulationStatus(simulation)}`;
  } else return null;

  return <div className="mt-3 border-t border-slate-200 pt-2 text-xs text-slate-600">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <progress aria-label={run ? '执行节点进度' : '轨迹采集进度'} className="h-1.5 w-28 accent-blue-600"
        value={completed} max={total} />
      <span role="status">{summary}</span>
    </div>
  </div>;
}

export function ProductionFlywheel({ run, detail, detailError, simulation, onOpenRun, actions, report, children }: {
  run?: GraphRun;
  detail?: GraphRunDetail;
  detailError?: string;
  simulation: CollectionSimulation | null;
  onOpenRun: () => void;
  actions?: ReactNode;
  report?: ReactNode;
  children?: ReactNode;
}) {
  const stages = detail?.stage_runs ?? [];
  const verifyingStageId = detail ? pendingArtifactVerificationTask(detail)?.stage_run_id : undefined;
  const processing = STAGES.map(([type, title]) => {
    const latest = stages.filter(stage => stage.node_type === type)
      .sort((a, b) => b.attempt - a.attempt || b.created_at.localeCompare(a.created_at));
    const stage = latest.find(item => run?.current_stage_ids.includes(item.run_id)) ?? latest[0];
    return stageStep(title, stage, run, verifyingStageId);
  });
  const steps = [collectionStep(run, simulation), ...processing, resultStep(run, processing)];
  return <section aria-label="生产飞轮" className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 xl:col-span-full">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold">生产飞轮</h3>
        {run && <p className="mt-1 text-xs text-slate-600">
          第 {run.round_no} 轮 · {graphRunStatusLabel(run.status)} · <code title={run.run_id}>{run.run_id.slice(0, 8)}</code>
        </p>}
      </div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {actions}
        {run && <button type="button" onClick={onOpenRun} className="rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700">查看执行记录</button>}
      </div>
    </div>
    {children}
    <ol aria-label="生产飞轮节点" className="mt-3 grid gap-5 md:grid-cols-5">
      {steps.map((step, index) => <li key={step.title} aria-current={step.current ? 'step' : undefined}
        className={`relative min-w-0 rounded-md border p-2.5 text-xs ${TONE[step.tone]} ${step.current ? 'ring-1 ring-current' : ''}`}>
        {index < steps.length - 1 && <span aria-hidden="true" className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-sm text-slate-500 md:-right-4 md:bottom-auto md:left-auto md:top-1/2 md:translate-x-0 md:-translate-y-1/2"><span className="md:hidden">↓</span><span className="hidden md:inline">→</span></span>}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
          <strong>{step.title}</strong>
          {step.current && <span className="text-[10px]">当前节点</span>}
        </div>
        <p className="mt-1 font-medium">{step.label}</p>
        {!!step.taskIds?.length && <p className="mt-1 break-words text-[11px]">平台任务 {step.taskIds.join('、')}</p>}
        {step.message && <p className="mt-1 break-words text-[11px]">{step.message}</p>}
      </li>)}
    </ol>
    <FlywheelProgress run={run} detail={detail} detailError={detailError} simulation={simulation} processing={processing} />
    {run?.failure?.message && !steps.some(step => step.message === run.failure?.message) && <p
      className="mt-3 break-words rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800"
    >{run.failure.message}</p>}
    {report}
  </section>;
}
