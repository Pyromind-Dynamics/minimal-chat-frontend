import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RequestOptions } from '../api';
import type { PublishedGraph } from '../echomindRuntime';
import { ProjectStorageBinding } from './ProjectStorageBinding';
import {
  applyRuntimeResourceProposal,
  checkRuntimeSlotHealth,
  collectionSimulationActive,
  collectionSimulationStatus,
  demoCollectionSelection,
  ensureRuntimeSlot,
  getCollectionSimulation,
  getRuntimeSlot,
  getRuntimeResourceProposal,
  isPlatformTracerScript,
  listCollectionSimulations,
  resumeCollectionSimulation,
  setTracerAdminKey,
  startCollectionSimulation,
  type CollectionSimulation,
  type ProjectRuntimeSlot,
  type RuntimeResourceHealth,
  type RuntimeResourceProposal,
} from '../echomindResources';

const SLOT_STATUS = {
  uninitialized: '待配置', initializing: '正在配置', ready: '已就绪', degraded: '健康检查异常', failed: '配置失败',
} satisfies Record<ProjectRuntimeSlot['status'], string>;

const HEALTH_STATUS = {
  unknown: '待检查', healthy: '健康', unhealthy: '异常',
} satisfies Record<RuntimeResourceHealth['status'], string>;

const inputClass = 'mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-xs disabled:bg-slate-50';
const buttonClass = 'rounded border px-3 py-1.5 text-xs font-medium disabled:opacity-40';
const RESOURCE_PROPOSAL_REQUEST = '请为当前 Project 的执行方案准备常驻 Inference 和 Tracer 的搭建方案。先复用对话里已确认的模型路径、模型名和 GPU 规格；缺少的参数请向我确认。把方案交给我审阅。';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formText(data: FormData, name: string): string {
  return String(data.get(name) ?? '').trim();
}

export interface CollectionState {
  simulation: CollectionSimulation | null;
  canRunBatch: boolean;
  demoSeed: CollectionSimulation | null;
  lastDemo: CollectionSimulation | null;
  batchSize: number;
}

export function ProjectRuntimeResources({
  projectId, requestOptions, published, stagingReleaseId, canRunCollectionBatch = false,
  onGraphRunStarted, onResourcesReady, onCollectionChanged, submittedCollection, onRequestResourceProposal, managerWorkbenchHref, resourceProposalDisabled = false,
}: {
  projectId: string;
  requestOptions: RequestOptions;
  published: PublishedGraph | null;
  stagingReleaseId?: string | null;
  canRunCollectionBatch?: boolean;
  onGraphRunStarted?: (id: string) => void;
  onResourcesReady?: (id: string | null) => void;
  onCollectionChanged?: (state: CollectionState) => void;
  submittedCollection?: CollectionSimulation | null;
  onRequestResourceProposal?: (text: string) => Promise<boolean>;
  managerWorkbenchHref?: string;
  resourceProposalDisabled?: boolean;
}) {
  const publishedReleaseId = published?.publication_mode === 'production' ? published.release_id : null;
  const releaseId = publishedReleaseId ?? stagingReleaseId;
  const [slot, setSlot] = useState<ProjectRuntimeSlot | null>(null);
  const [simulation, setSimulation] = useState<CollectionSimulation | null>(null);
  const [lastDemo, setLastDemo] = useState<CollectionSimulation | null>(null);
  const [demoSeed, setDemoSeed] = useState<CollectionSimulation | null>(null);
  const [proposal, setProposal] = useState<RuntimeResourceProposal | null>(null);
  const [setupAttempt, setSetupAttempt] = useState<{previousSlotUpdatedAt?: string} | null>(null);
  const [setupPollExpired, setSetupPollExpired] = useState(false);
  const [proposalPending, setProposalPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadedRelease, setLoadedRelease] = useState<string | null>(null);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'setup' | 'health' | 'admin' | 'collection' | null>(null);
  const [reload, setReload] = useState(0);
  const collectionRequest = useRef<{id: string; input: string} | null>(null);
  const reportedRun = useRef<string | null>(null);

  const matchesRelease = slot?.active_release_id === releaseId;
  const ready = !!releaseId && matchesRelease && slot?.status === 'ready';
  const currentProposal = proposal?.release_id === releaseId ? proposal : null;
  const setupPending = setupAttempt !== null;
  const readyForPublication = ready && loadedRelease === releaseId && !loading && busy !== 'health';
  const setupInitializing = matchesRelease && slot?.status === 'initializing';
  const batchSize = slot?.tracer?.buffer_config.batch_size ?? demoSeed?.requested_samples ?? 10;
  const platformBatchTrigger = isPlatformTracerScript(projectId, slot?.tracer?.custom_runtime_script_path);
  const batchExecutionAvailable = canRunCollectionBatch && slot?.batch_execution_available === true;
  const active = simulation ? collectionSimulationActive(simulation) : false;
  const activeSimulationId = publishedReleaseId && active ? simulation?.simulation_id : undefined;
  const newRunId = simulation?.graph_run_ids[0];

  useEffect(() => {
    onResourcesReady?.(readyForPublication && releaseId ? releaseId : null);
  }, [onResourcesReady, readyForPublication, releaseId]);

  useEffect(() => {
    onCollectionChanged?.({
      simulation: publishedReleaseId ? simulation : null, canRunBatch: ready && batchExecutionAvailable,
      demoSeed: publishedReleaseId ? demoSeed : null, lastDemo, batchSize,
    });
  }, [onCollectionChanged, publishedReleaseId, simulation, ready, batchExecutionAvailable, demoSeed, lastDemo, batchSize]);

  useEffect(() => {
    if (submittedCollection) setSimulation(submittedCollection);
  }, [submittedCollection]);

  useEffect(() => {
    if (!releaseId) return;
    let disposed = false;
    setLoading(true);
    setLoadedRelease(null);
    setResourceError(null);
    setCollectionError(null);
    const resources = getRuntimeSlot(projectId, requestOptions).then(value => {
      if (!disposed) {
        setSlot(value);
        setLoadedRelease(releaseId);
      }
    }).catch(error => { if (!disposed) setResourceError(messageOf(error)); });
    const collections = !publishedReleaseId ? Promise.resolve() : listCollectionSimulations(projectId, requestOptions).then(items => {
      if (!disposed) {
        setSimulation(items[0] ?? null);
        setLastDemo(items.find(item => demoCollectionSelection(item)) ?? null);
        setDemoSeed(items.find(item => item.manual_start && item.auto_start_graph_run) ?? null);
      }
    }).catch(error => { if (!disposed) setCollectionError(messageOf(error)); });
    const loadProposal = getRuntimeResourceProposal(projectId, requestOptions).then(value => {
      if (!disposed && value?.release_id === releaseId) {
        setProposal(value);
        setProposalPending(false);
      }
    }).catch(error => { if (!disposed) setResourceError(messageOf(error)); });
    void Promise.all([resources, collections, loadProposal]).then(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [projectId, releaseId, publishedReleaseId, reload, requestOptions]);

  useEffect(() => {
    if (!releaseId || !proposalPending || proposal?.release_id === releaseId) return;
    let disposed = false;
    let timer: number | undefined;
    const deadline = Date.now() + 120_000;
    const poll = async () => {
      try {
        const value = await getRuntimeResourceProposal(projectId, requestOptions);
        if (disposed) return;
        if (value?.release_id === releaseId) {
          setProposal(value);
          setProposalPending(false);
          return;
        }
        if (Date.now() < deadline) timer = window.setTimeout(() => void poll(), 3000);
        else {
          setProposalPending(false);
          setResourceError('暂未收到搭建方案，请查看主对话是否在等待补充信息。');
        }
      } catch (error) {
        if (!disposed) {
          setProposalPending(false);
          setResourceError(messageOf(error));
        }
      }
    };
    timer = window.setTimeout(() => void poll(), 1500);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [projectId, proposal?.release_id, proposalPending, releaseId, requestOptions]);

  useEffect(() => {
    if (!releaseId || setupPollExpired || (!setupPending && !setupInitializing)) return;
    let disposed = false;
    let timer: number | undefined;
    const started = Date.now();
    const deadline = started + 360_000;
    const poll = async () => {
      try {
        const value = await getRuntimeSlot(projectId, requestOptions);
        if (disposed) return;
        const previousAttempt = setupAttempt?.previousSlotUpdatedAt
          && value?.active_release_id === releaseId
          && value.updated_at === setupAttempt.previousSlotUpdatedAt;
        if (!previousAttempt) setSlot(value);
        if (value?.active_release_id === releaseId && !previousAttempt) {
          setLoadedRelease(releaseId);
          if (value.status === 'ready' && publishedReleaseId && canRunCollectionBatch && !value.batch_execution_available && setupPending && Date.now() < started + 20_000) {
            timer = window.setTimeout(() => void poll(), 2000);
            return;
          }
          if (value.status === 'ready' || value.status === 'degraded' || value.status === 'failed') {
            setSetupAttempt(null);
            return;
          }
        }
        if (Date.now() < deadline) timer = window.setTimeout(() => void poll(), 3000);
        else {
          setSetupAttempt(null);
          setSetupPollExpired(true);
        }
      } catch (error) {
        if (!disposed) {
          setSetupAttempt(null);
          setResourceError(messageOf(error));
        }
      }
    };
    timer = window.setTimeout(() => void poll(), 1500);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [canRunCollectionBatch, projectId, publishedReleaseId, releaseId, requestOptions, setupAttempt, setupInitializing, setupPending, setupPollExpired]);

  useEffect(() => {
    if (!activeSimulationId) return;
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const result = await getCollectionSimulation(projectId, activeSimulationId, requestOptions);
        if (disposed) return;
        setSimulation(result);
        if (collectionSimulationActive(result)) timer = window.setTimeout(() => void poll(), 3000);
      } catch (error) {
        if (!disposed) setCollectionError(messageOf(error));
      }
    };
    timer = window.setTimeout(() => void poll(), 3000);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [activeSimulationId, projectId, reload, requestOptions]);

  useEffect(() => {
    if (!newRunId || !onGraphRunStarted || reportedRun.current === newRunId) return;
    reportedRun.current = newRunId;
    onGraphRunStarted(newRunId);
  }, [newRunId, onGraphRunStarted]);

  async function setupResources(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const batchSize = Number(formText(data, 'batch_size'));
    const capacity = Number(formText(data, 'capacity'));
    if (capacity <= batchSize) {
      setResourceError('轨迹缓冲容量必须大于每批样本数。');
      return;
    }
    const existingTracer = slot?.tracer?.resource_id || formText(data, 'tracer_id');
    const model = formText(data, 'origin_model');
    setBusy('setup');
    setResourceError(null);
    try {
      setSlot(await ensureRuntimeSlot(projectId, {
        serving_inference_id: slot?.tracer && slot.serving_inference?.resource_id || formText(data, 'inference_id'),
        tracer: {
          origin_model: model,
          training_model: model,
          training_batch_size: batchSize,
          trajectory_buffer_size: capacity,
          time_per_round_seconds: 60,
          training_rounds: 1,
          training_save_path: formText(data, 'save_path'),
          execution_mode: 'manual',
        },
        ...(existingTracer ? {attach_existing_tracer_id: existingTracer} : {}),
      }, requestOptions));
    } catch (error) {
      setResourceError(messageOf(error));
    } finally {
      setBusy(null);
    }
  }

  async function applyProposal() {
    if (!proposal || proposal.release_id !== releaseId) return;
    setBusy('setup');
    setResourceError(null);
    try {
      await applyRuntimeResourceProposal(projectId, proposal.digest, requestOptions);
      setSetupPollExpired(false);
      setSetupAttempt({previousSlotUpdatedAt: matchesRelease ? slot?.updated_at : undefined});
    } catch (error) {
      setResourceError(messageOf(error));
    } finally {
      setBusy(null);
    }
  }

  async function requestProposal() {
    if (!onRequestResourceProposal || proposalPending) return;
    setResourceError(null);
    setProposalPending(true);
    if (!await onRequestResourceProposal(RESOURCE_PROPOSAL_REQUEST)) {
      setProposalPending(false);
      setResourceError('搭建请求未发给 Agent，请查看对话提示后重试。');
    }
  }

  async function checkHealth() {
    setBusy('health');
    setResourceError(null);
    try {
      setSlot(await checkRuntimeSlotHealth(projectId, requestOptions));
      setLoadedRelease(releaseId ?? null);
    } catch (error) {
      setLoadedRelease(null);
      setResourceError(messageOf(error));
    } finally {
      setBusy(null);
    }
  }

  async function configureTracerAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const key = formText(new FormData(form), 'admin_key');
    if (!key) return;
    setBusy('admin');
    setResourceError(null);
    try {
      setSlot(await setTracerAdminKey(projectId, key, requestOptions));
      form.reset();
    } catch (error) {
      setResourceError(messageOf(error));
    } finally {
      setBusy(null);
    }
  }

  async function collect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const runBatch = batchExecutionAvailable && submitter?.getAttribute('value') === 'run';
    const sampleUri = formText(data, 'sample_uri');
    const validationUri = formText(data, 'validation_uri');
    const limit = platformBatchTrigger ? batchSize : Number(formText(data, 'sample_count'));
    if (runBatch && (!validationUri || validationUri === sampleUri || limit < 2)) {
      setCollectionError('运行一轮需要不同的训练和验证 JSONL，采集至少 2 条。');
      return;
    }
    if (runBatch && !platformBatchTrigger && limit >= batchSize) {
      setCollectionError('运行一轮的采集条数需要小于 Tracer 的每批样本数，便于在写完标准答案后手动封批。');
      return;
    }
    const source = {train_uri: sampleUri, val_uri: validationUri || sampleUri, image_root: formText(data, 'image_root')};
    setBusy('collection');
    setCollectionError(null);
    try {
      const input = JSON.stringify({source, limit, runBatch});
      if (collectionRequest.current?.input !== input) {
        collectionRequest.current = {id: crypto.randomUUID(), input};
      }
      setSimulation(await startCollectionSimulation(projectId, collectionRequest.current.id, source, limit, runBatch, requestOptions));
      collectionRequest.current = null;
    } catch (error) {
      setCollectionError(messageOf(error));
    } finally {
      setBusy(null);
    }
  }

  async function resumeCollection() {
    if (!simulation) return;
    setBusy('collection');
    setCollectionError(null);
    try {
      setSimulation(await resumeCollectionSimulation(projectId, simulation.simulation_id, requestOptions));
      setReload(value => value + 1);
    } catch (error) {
      setCollectionError(messageOf(error));
    } finally {
      setBusy(null);
    }
  }

  return <section id="project-runtime-resources" tabIndex={-1} aria-label="常驻资源" className="min-w-0 rounded-lg border bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">常驻资源</h3>
      {releaseId && <button type="button" className={buttonClass} disabled={loading || busy !== null} onClick={() => setReload(value => value + 1)}>刷新状态</button>}
    </div>
    <ProjectStorageBinding key={projectId} projectId={projectId} requestOptions={requestOptions} />
    {!ready && !currentProposal && managerWorkbenchHref && <div className="mt-3 rounded border border-slate-200 p-3 text-xs text-slate-700">
      <p>请在原 Project 采用通过的调试方案，再让 Agent 搭建 Inference 和 Tracer。</p>
      <a href={managerWorkbenchHref} className={`${buttonClass} mt-2 inline-block border-blue-700 bg-blue-700 text-white`}>到原 Project 采用并搭建</a>
    </div>}
    {!releaseId ? !managerWorkbenchHref && <p className="mt-2 text-xs text-slate-600">采用通过调试的执行方案后，可在这里搭建 Inference 和 Tracer。</p> : <>
      {loading && <p role="status" className="mt-2 text-xs text-slate-500">正在读取资源状态…</p>}
      {resourceError && <p role="alert" className="mt-2 break-words text-xs text-red-700">{resourceError}</p>}
      {!setupPending && slot?.error && <p className="mt-2 break-words text-xs text-amber-800">{slot.error}</p>}
      {setupPending && <p role="status" className="mt-2 text-xs text-slate-600">正在搭建 Inference 和 Tracer，可稍后回来查看。</p>}
      {!ready && (currentProposal || onRequestResourceProposal) && <div className="mt-3 rounded border border-slate-200 p-3 text-xs text-slate-700">
        {currentProposal ? <>
          <h4 className="font-semibold">Agent 的资源搭建方案</h4>
          <p className="mt-1 break-words">{currentProposal.setup.serving_inference_create
            ? `${currentProposal.setup.serving_inference_create.model_name} · ${currentProposal.setup.serving_inference_create.model_path} · ${currentProposal.setup.serving_inference_create.gpu_count} × ${currentProposal.setup.serving_inference_create.gpu_card}`
            : `绑定 Inference ${currentProposal.setup.serving_inference_id}`}</p>
          <p className="mt-1">{currentProposal.setup.attach_existing_tracer_id ? `绑定 Tracer ${currentProposal.setup.attach_existing_tracer_id}` : '创建 Tracer'} · 每批 {currentProposal.setup.tracer.training_batch_size} 条</p>
          <button type="button" className={`${buttonClass} mt-2 border-emerald-700 bg-emerald-700 text-white`}
            disabled={busy !== null || setupPending} onClick={() => void applyProposal()}>{setupInitializing || setupPollExpired || slot?.status === 'degraded' || slot?.status === 'failed' ? '继续搭建资源' : '确认并搭建资源'}</button>
        </> : <>
          <p role={proposalPending || resourceProposalDisabled ? 'status' : undefined}>{proposalPending
            ? resourceProposalDisabled ? '正在发送搭建请求…' : '已请 Agent 准备资源方案。若需要确认模型或 GPU，Agent 会在当前对话询问。'
            : resourceProposalDisabled ? '对话正在加载或发送消息，稍后可发起搭建。'
              : '请 Agent 根据当前执行方案准备 Inference 和 Tracer。确认搭建方案后才会提交资源。'}</p>
          {!proposalPending && <button type="button" className={`${buttonClass} mt-2 border-blue-700 bg-blue-700 text-white`}
            disabled={resourceProposalDisabled || busy !== null} onClick={() => void requestProposal()}>让 Agent 准备搭建方案</button>}
        </>}
      </div>}
      {slot && <>
        <p className="mt-2 text-xs font-medium text-slate-600">{setupPending ? SLOT_STATUS.initializing : matchesRelease ? SLOT_STATUS[slot.status] : '资源尚未绑定当前执行方案'}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <ResourceSummary title="在线推理 Inference" id={slot.serving_inference?.resource_id} health={slot.serving_inference?.health} detail={slot.serving_inference?.model_uri} />
          <ResourceSummary title="轨迹采集 Tracer" id={slot.tracer?.resource_id} health={slot.tracer?.health} detail={slot.tracer?.endpoint} />
        </div>
        {slot.baseline && <p className="mt-2 break-words text-xs text-slate-600">评测基线 {slot.baseline.dataset_uri} · {Object.entries(slot.baseline.metrics).map(([key, value]) => `${key} ${value}`).join(' · ')}</p>}
        {slot.tracer && slot.serving_inference && <button type="button" disabled={busy !== null || loading} onClick={() => void checkHealth()} className={`${buttonClass} mt-2`}>{busy === 'health' ? '正在检查…' : '检查健康'}</button>}
        {matchesRelease && platformBatchTrigger && slot.batch_execution_available && <p className="mt-2 text-xs text-slate-600">平台 EchoMind 每采满 {batchSize} 条自动封批。</p>}
        {canRunCollectionBatch && matchesRelease && slot.tracer?.resource_id && <details className="mt-2 rounded border p-2 text-xs text-slate-600">
          <summary className="cursor-pointer font-medium">{platformBatchTrigger ? '配置批次自动释放' : batchExecutionAvailable ? '已验证 Tracer 批次权限' : '配置 Tracer 批次权限'}</summary>
          {platformBatchTrigger
            ? <p className="mt-2">绑定平台授予的 Tracer 管理密钥后，已成功且通过归档校验的旧批次可自动释放。</p>
            : <p className="mt-2">{batchExecutionAvailable ? '单批验收会保留 Tracer 原始批次，便于核对或重试。' : '采集并运行一轮需要支持批次管理的 Tracer 和对应的 Admin Key。'}</p>}
          <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={event => void configureTracerAdmin(event)}>
            <ResourceField name="admin_key" label="Tracer Admin Key" type="password" autoComplete="off" required maxLength={1024} disabled={busy !== null} />
            <button type="submit" className={buttonClass} disabled={busy !== null}>{busy === 'admin' ? '正在验证…' : '验证并保存'}</button>
          </form>
        </details>}
      </>}
      {!loading && !ready && !setupPending && !setupInitializing && loadedRelease === releaseId && <details className="mt-3 rounded border border-slate-200 p-3 text-xs">
        <summary className="cursor-pointer font-medium">绑定已有资源</summary>
        <form onSubmit={event => void setupResources(event)} key={slot?.tracer?.resource_id ?? 'new'} className="mt-3 space-y-3">
        <p className="text-xs text-slate-600">绑定已部署的 Inference。可使用已指向它的 Tracer，也可为当前 Project 创建 Tracer。</p>
        <fieldset disabled={busy !== null} className="grid gap-2 sm:grid-cols-2">
          <ResourceField name="inference_id" label="Inference 任务 ID" required maxLength={128} defaultValue={slot?.serving_inference?.resource_id ?? ''} readOnly={!!slot?.tracer} />
          <ResourceField name="tracer_id" label="现有 Tracer 任务 ID（可选）" maxLength={128} defaultValue={slot?.tracer?.resource_id ?? ''} readOnly={!!slot?.tracer} />
          <ResourceField name="origin_model" label="推理模型名称" required maxLength={256} />
          <ResourceField name="save_path" label="Tracer 保存路径" required maxLength={2000} defaultValue={slot?.tracer?.buffer_config.training_save_path ?? ''} />
          <ResourceField name="batch_size" label="每批样本数" type="number" required min={1} defaultValue={slot?.tracer?.buffer_config.batch_size ?? 10} />
          <ResourceField name="capacity" label="轨迹缓冲容量" type="number" required min={2} defaultValue={slot?.tracer?.buffer_config.trajectory_buffer_size ?? 30} />
        </fieldset>
        <button type="submit" className={`${buttonClass} border-emerald-700 bg-emerald-700 text-white`} disabled={busy !== null}>{busy === 'setup' ? '正在绑定并探活…' : '绑定资源并检查健康'}</button>
      </form></details>}
      {publishedReleaseId && <div className="mt-4 border-t pt-3">
        <h4 className="text-xs font-semibold">小批量采集验收</h4>
        {collectionError && <p role="alert" className="mt-2 break-words text-xs text-red-700">{collectionError}</p>}
        {simulation && <div className="mt-2 space-y-1 text-xs text-slate-600" role="status">
          <p>{collectionSimulationStatus(simulation)} · {simulation.completed_samples}/{simulation.requested_samples} 条{simulation.failed_samples > 0 ? ` · ${simulation.failed_samples} 条失败` : ''}</p>
          {simulation.batch_ids.length > 0 && <p className="break-words">批次 {simulation.batch_ids.join('、')}</p>}
          {simulation.graph_run_ids.length > 0 && <p className="break-words">运行 {simulation.graph_run_ids.join('、')}</p>}
          {simulation.error && <p className="break-words text-amber-800">{simulation.error}</p>}
          {ready && simulation.status === 'paused' && <button type="button" className={buttonClass} disabled={busy !== null || (simulation.auto_start_graph_run && !batchExecutionAvailable)} onClick={() => void resumeCollection()}>继续本次采集</button>}
        </div>}
        {ready && !demoSeed && <form onSubmit={event => void collect(event)} className="mt-2 space-y-2">
          <p className="text-xs text-slate-600">使用含样本 ID、提示词、图片路径和标准答案的 Storage JSONL。采集后封存一批。</p>
          {platformBatchTrigger && batchExecutionAvailable && <p className="text-xs text-slate-600">运行一轮需至少 {Math.ceil(batchSize / 2)} 条训练样本和 {Math.floor(batchSize / 2)} 条验证样本，样本 ID 不可重复。</p>}
          <fieldset disabled={loading || busy !== null || active} className="grid gap-2 sm:grid-cols-2">
            <ResourceField name="sample_uri" label={batchExecutionAvailable ? '训练样本 JSONL 路径' : '采样 JSONL 路径'} required maxLength={4000} />
            {batchExecutionAvailable && <ResourceField name="validation_uri" label="验证样本 JSONL 路径（运行一轮时必填）" maxLength={4000} />}
            <ResourceField name="image_root" label="图片根目录" required maxLength={4000} />
            {platformBatchTrigger
              ? <ResourceField name="sample_count" label="采集条数" type="number" readOnly value={batchSize} />
              : <ResourceField key={batchExecutionAvailable ? 'with-admin' : 'seal-only'} name="sample_count" label="采集条数" type="number" min={1} max={Math.min(batchSize, 100)} required defaultValue={Math.min(10, Math.max(1, batchSize - (batchExecutionAvailable ? 1 : 0)))} />}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={buttonClass} disabled={loading || busy !== null || active}>{busy === 'collection' ? '正在提交…' : '采集并封存一批'}</button>
            {batchExecutionAvailable && <button type="submit" value="run" className={`${buttonClass} border-blue-700 bg-blue-700 text-white`} disabled={loading || busy !== null || active}>采集并运行一轮</button>}
          </div>
        </form>}
        {!ready && <p className="mt-2 text-xs text-slate-500">当前发布版本的 Inference 和 Tracer 就绪后，可发起采集验收。</p>}
      </div>}
    </>}
  </section>;
}

function ResourceSummary({title, id, health, detail}: {
  title: string;
  id?: string | null;
  health?: RuntimeResourceHealth;
  detail?: string | null;
}) {
  return <article className="min-w-0 rounded border bg-slate-50 p-2 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-1">
      <h4 className="font-semibold">{title}</h4>
      <span className={health?.status === 'healthy' ? 'text-emerald-700' : 'text-slate-600'}>{id ? HEALTH_STATUS[health?.status ?? 'unknown'] : '未绑定'}</span>
    </div>
    {id && <p className="mt-1 break-all font-mono text-slate-600">{id}</p>}
    {detail && <p className="mt-1 break-all text-slate-500">{detail}</p>}
    {health?.checked_at && <p className="mt-1 text-slate-500">检查于 {new Date(health.checked_at).toLocaleString()}</p>}
    {health?.message && <p className="mt-1 break-words text-amber-800">{health.message}</p>}
  </article>;
}

function ResourceField({label, ...props}: React.ComponentPropsWithoutRef<'input'> & {label: string}) {
  return <label className="text-xs text-slate-700">{label}<input {...props} className={inputClass} /></label>;
}
