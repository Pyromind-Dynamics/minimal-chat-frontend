import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { RequestOptions } from '../api';
import { latestGraphConsolidationJob, type ConsolidationGeneration, type ConsolidationJob, type ConsolidationReview, type ConsolidationState, type ConsolidationTaskIds, type DatasetReplayEvidence, type FullProjectInfo, type RuntimeContractUpgradeDraft } from '../echomindRuntime';
import type { ProductClient } from '../productClient';

const STAGES = ['dataset', 'train', 'eval'] as const;
const LABELS = {dataset: 'Dataset', train: 'Train', eval: 'Eval'};
const BUTTON = 'rounded border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50';
const JOB_LABELS: Record<ConsolidationJob['status'], string> = {
  queued: '等待主 Agent 空闲', running: '正在检查与补齐', waiting_external: '等待外部任务或产物',
  waiting_input: '等待用户确认', blocked: '需要处理阻塞项', paused: '已暂停',
  budget_limited: '已达到本次执行限制', ready: '当前检查已通过',
};
const DELIVERY_LABELS = {pending: '待交付', revising: '修正中', verified: '交付已验收', needs_verification: '待复核'};
const ACTIVE_JOB_STATES = new Set<ConsolidationJob['status']>(['queued', 'running', 'waiting_external', 'waiting_input']);

export function ConsolidationProgress({ state, disabled, onControl }: {
  state: ConsolidationState;
  disabled: boolean;
  onControl: (job: ConsolidationJob, action: 'pause' | 'resume') => void;
}) {
  const job = latestGraphConsolidationJob(state);
  return <div aria-label="固化任务进度" className="space-y-2 rounded border border-blue-100 bg-white/70 p-2 text-xs text-slate-700">
    {state.project_goal && <p><span className="font-medium">Project 目标</span> · {state.project_goal}</p>}
    {!!Object.keys(state.stages).length && <ul aria-label="节点交付状态" className="flex flex-wrap gap-x-4 gap-y-1">
      {Object.values(state.stages).map(stage => <li key={stage.stage_id}>
        {LABELS[stage.stage_id as keyof typeof LABELS] ?? stage.stage_id} · {DELIVERY_LABELS[stage.status]}
        {stage.current_revision > 0 && <span className="ml-1 text-slate-500">v{stage.current_revision}</span>}
      </li>)}
    </ul>}
    {job && <div className="flex flex-wrap items-center gap-2">
      <p role="status">{JOB_LABELS[job.status]}{job.waiting_reason && ` · ${job.waiting_reason}`}</p>
      {ACTIVE_JOB_STATES.has(job.status) && <button type="button" disabled={disabled} className={BUTTON} onClick={() => onControl(job, 'pause')}>暂停固化任务</button>}
      {['paused', 'blocked', 'budget_limited'].includes(job.status) && <button type="button" disabled={disabled} className={BUTTON} onClick={() => onControl(job, 'resume')}>继续固化任务</button>}
    </div>}
  </div>;
}

interface GenerationRequest {
  taskIds: ConsolidationTaskIds;
  reviewOnly: boolean;
  retryCommandId?: string;
  restored?: boolean;
}

function savedRequest(key: string): GenerationRequest | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (!saved || typeof saved.reviewOnly !== 'boolean' || !saved.taskIds
      || !Object.entries(saved.taskIds).every(([stage, id]) => STAGES.some(name => name === stage) && typeof id === 'string')) return null;
    return { taskIds: saved.taskIds, reviewOnly: saved.reviewOnly, restored: true };
  } catch { return null; }
}

function remember(key: string, request: GenerationRequest | null) {
  try {
    if (request) sessionStorage.setItem(key, JSON.stringify({taskIds: request.taskIds, reviewOnly: request.reviewOnly}));
    else sessionStorage.removeItem(key);
  } catch { /* Generation can continue when browser storage is disabled. */ }
}

const SOURCE_KIND_LABELS: Record<string, string> = {
  image_directory: '图片目录', record_directory: '批次记录目录（train.jsonl）', jsonl: 'JSONL 文件',
};

export function DatasetReplayPolicy({ replay }: { replay: DatasetReplayEvidence }) {
  const sourceKinds = [...new Set(replay.source_kinds)].map(kind => SOURCE_KIND_LABELS[kind] ?? kind);
  let validation = '未记录';
  if (replay.fixed_validation_path) validation = '固定文件 · ' + replay.fixed_validation_path;
  else if (replay.fixed_validation_path === null) {
    validation = replay.val_rows?.length && replay.val_rows.every(count => count === 0)
      ? '回放批次无训练中验证样本' : '按配方从当前批次切分';
  }
  return <>
    <div><dt className="font-medium">训练标签来源</dt>
      <dd>{replay.batch_label_source === 'dataset' ? '由 Dataset 提供' : replay.batch_label_source === 'collection' ? '由采集侧提供' : '未指定'}</dd></div>
    <div><dt className="font-medium">训练中验证数据</dt><dd>{validation}</dd></div>
    <div><dt className="font-medium">已回放的输入形式</dt><dd>{sourceKinds.join('、') || '未记录'}</dd></div>
  </>;
}

interface Props {
  client: ProductClient;
  projectId: string;
  storageKey: string;
  options: RequestOptions;
  disabled: boolean;
  onApply: (project: FullProjectInfo) => Promise<void>;
  renderDraft: (draft: RuntimeContractUpgradeDraft) => ReactNode;
}

export function ExecutionPlanConsolidation({ client, projectId, storageKey, options, disabled, onApply, renderDraft }: Props) {
  const [request, setRequest] = useState<GenerationRequest | null>(() => savedRequest(storageKey));
  const [taskIds, setTaskIds] = useState<ConsolidationTaskIds>(request?.taskIds ?? {});
  const [review, setReview] = useState<ConsolidationReview | null>(null);
  const [repair, setRepair] = useState<ConsolidationGeneration['repair']>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [progressError, setProgressError] = useState('');
  const [goalState, setGoalState] = useState<ConsolidationState | null>(null);
  const [serverManaged, setServerManaged] = useState<boolean | null>(null);
  const [selectionDirty, setSelectionDirty] = useState(false);
  const [controlling, setControlling] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function readProgress() {
      try {
        const state = await client.consolidationJobs(projectId, options, controller.signal);
        if (controller.signal.aborted) return;
        setServerManaged(true);
        setGoalState(state);
        setProgressError('');
        const job = latestGraphConsolidationJob(state);
        if (job && !selectionDirty) {
          if (job.review?.context) setReview(job.review);
          if (!request) setTaskIds(job.task_ids);
          setRepair(job.status === 'ready' ? null : {
            stage: job.blockers[0]?.stage ?? 'dataset', command_id: job.repair_command_id ?? '',
            status: job.status === 'waiting_input' ? 'needs_input' : ACTIVE_JOB_STATES.has(job.status) ? 'working' : 'blocked',
            message: job.waiting_reason ?? JOB_LABELS[job.status],
          });
        }
      } catch (failure) {
        if (controller.signal.aborted) return;
        const message = failure instanceof Error ? failure.message : String(failure);
        if (message.startsWith('Request failed: 404 ')) {
          setServerManaged(false);
          return;
        }
        setProgressError(message);
      }
      timer = setTimeout(() => void readProgress(), 8_000);
    }
    void readProgress();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [client, projectId, options, request, selectionDirty]);

  useEffect(() => {
    if (!request || disabled || serverManaged === null) return;
    if (request.restored && serverManaged) {
      setRequest(null);
      return;
    }
    const controller = new AbortController();
    const reviewOnly = request.reviewOnly;
    let selected = request.taskIds;
    let retryId = request.retryCommandId;
    async function check() {
      try {
        const result = reviewOnly
          ? {review: await client.reviewConsolidation(projectId, selected, options, true), repair: null}
          : await client.generateConsolidation(projectId, selected, options, retryId, controller.signal, serverManaged === true);
        if (controller.signal.aborted) return;
        retryId = undefined;
        selected = Object.fromEntries(STAGES.map(stage => [stage, result.review.context.evidence[stage].task_id]));
        setTaskIds(selected);
        setReview(result.review);
        setRepair(result.repair);
        remember(storageKey, {taskIds: selected, reviewOnly: !result.repair});
        if (serverManaged !== true && (result.repair?.status === 'working' || result.repair?.status === 'needs_input')) {
          timer = setTimeout(() => void check(), 8_000);
        } else {
          setRequest(null);
        }
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(failure instanceof Error ? failure.message : String(failure));
        setRequest(null);
      }
    }
    let timer = setTimeout(() => void check(), 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [client, projectId, storageKey, options, disabled, request, serverManaged]);

  const currentJob = goalState ? latestGraphConsolidationJob(goalState) : null;
  const blocked = disabled || !!request || applying || !!currentJob && ACTIVE_JOB_STATES.has(currentJob.status);
  const source = review?.context.source_batch ?? review?.context.image_directory;
  const canApply = !!review?.draft && !review.issue && !repair && !review.blockers?.length
    && review.stages?.some(stage => stage.stage === 'dataset' && stage.verification === 'replayed')
    && !review.stages.some(stage => stage.status === 'blocked') && !!review.proposal_sha256;
  const retryCommandId = repair?.status === 'blocked' && repair.command_id ? repair.command_id : undefined;
  const start = () => {
    if (blocked) return;
    const next = {taskIds, reviewOnly: false, retryCommandId};
    setSelectionDirty(false);
    remember(storageKey, next);
    setError('');
    setReview(null);
    setRepair(null);
    setRequest(next);
  };
  const controlJob = async (job: ConsolidationJob, action: 'pause' | 'resume') => {
    setControlling(true);
    setProgressError('');
    try {
      await client.controlConsolidationJob(projectId, job, action, options);
      const state = await client.consolidationJobs(projectId, options);
      if (mounted.current) setGoalState(state);
    } catch (failure) {
      if (mounted.current) setProgressError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (mounted.current) setControlling(false);
    }
  };
  const apply = async () => {
    if (blocked || !canApply || !review?.proposal_sha256) return;
    setApplying(true);
    setError('');
    try {
      const result = await client.applyConsolidation(projectId, taskIds, review.proposal_sha256, options);
      remember(storageKey, null);
      if (mounted.current) await onApply(result);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (mounted.current) setApplying(false);
    }
  };

  return <section aria-label="研发成果转执行方案" className="mt-4 space-y-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3">
    <h4 className="text-sm font-semibold">从研发成果生成执行方案</h4>
    {goalState && <ConsolidationProgress state={goalState} disabled={controlling || applying} onControl={(job, action) => void controlJob(job, action)} />}
    {progressError && <p role="alert" className="text-xs text-red-800">{progressError}</p>}
    <details className="text-xs">
      <summary className="cursor-pointer text-slate-700">指定研发任务 ID</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {STAGES.map(stage => <label key={stage}>{LABELS[stage]}
          <input disabled={blocked} inputMode="numeric" placeholder="自动选择" value={taskIds[stage] ?? ''}
            onChange={event => {
              remember(storageKey, null);
              setSelectionDirty(true);
              setTaskIds({...taskIds, [stage]: event.target.value});
              setReview(null);
              setRepair(null);
              setError('');
            }} className="mt-1 block w-full rounded border bg-white p-1.5" />
        </label>)}
      </div>
    </details>
    {review && <dl className="space-y-1 break-all text-xs text-slate-700">
      <div><dt className="font-medium">Dataset 本轮输入</dt><dd>{source ?? '未记录'}</dd></div>
      {review.assets?.dataset_replay && <DatasetReplayPolicy replay={review.assets.dataset_replay} />}
      <div><dt className="font-medium">Train 基础模型</dt><dd>{review.context.base_model}</dd></div>
      <div><dt className="font-medium">Eval 固定评测集</dt><dd>{review.context.validation_dataset}</dd></div>
    </dl>}
    {review && <ul aria-label="阶段校验结果" className="space-y-2 text-xs">
      {STAGES.map(stage => {
        const item = review.stages?.find(value => value.stage === stage);
        const issues = review.blockers?.filter(value => value.stage === stage) ?? [];
        const label = item?.status === 'blocked' || issues.length ? '待补齐'
          : item?.verification === 'replayed' ? '已用新批次回放验证'
          : item?.verification === 'static' || item?.status === 'ready' ? '已通过静态校验' : '待验证';
        return <li key={stage}>
          <strong>{LABELS[stage]} · {label}</strong>
          <span className="ml-2 text-slate-600">研发任务 {review.context.evidence[stage].task_id}</span>
          {!!item?.verification_task_ids?.length && <span className="ml-2 text-slate-600">回放任务 {item.verification_task_ids.join('、')}</span>}
          {issues.map(issue => <p key={issue.code} className="text-amber-800">{issue.message}</p>)}
        </li>;
      })}
    </ul>}
    {repair && <div role="status" className="space-y-1 text-xs text-slate-700">
      <p>{LABELS[repair.stage]} · {repair.message}</p>
      {repair.status === 'needs_input' && <p>请在当前 Project 的「待确认」中回复 Agent，工作台会继续检查。</p>}
    </div>}
    {!repair && request && <p role="status" className="text-xs text-slate-600">{disabled ? '等待当前操作完成' : request.reviewOnly ? '正在恢复审阅结果…' : '正在核对研发记录和 Storage 产物。回放校验可能需要数分钟。'}</p>}
    {review?.issue && <p role="alert" className="text-xs text-amber-900">{review.issue}</p>}
    {error && <p role="alert" className="text-xs text-red-800">{error}</p>}
    {canApply && review?.draft && <div className="space-y-2">
      {renderDraft(review.draft)}
      <details className="text-xs">
        <summary className="cursor-pointer">查看平台工作流和参数</summary>
        {review.draft.nodes.map(node => <div key={node.id} className="mt-2 min-w-0">
          <p className="font-medium">{node.title}</p>
          <pre className="mt-1 max-h-60 overflow-auto rounded border bg-white p-2">{JSON.stringify(node.config[node.executor], null, 2)}</pre>
        </div>)}
      </details>
    </div>}
    <div className="flex flex-wrap gap-2">
      {canApply
        ? <button type="button" disabled={blocked} className={`${BUTTON} border-blue-700 bg-blue-700 text-white`} onClick={() => void apply()}>{applying ? '正在采用…' : '确认采用执行方案'}</button>
        : <button type="button" disabled={blocked} className={`${BUTTON} bg-white text-blue-800`} onClick={start}>
          {request ? '生成与验证进行中' : retryCommandId ? '重试该节点' : error || repair?.status === 'blocked' ? '重新检查执行方案' : '生成并验证执行方案'}
        </button>}
    </div>
  </section>;
}
