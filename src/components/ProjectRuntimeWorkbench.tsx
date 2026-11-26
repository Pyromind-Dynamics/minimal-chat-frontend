import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RequestOptions } from '../api';
import type { ModelEvaluationRecord } from '../echomindOperations';
import { collectionSimulationActive, demoCollectionSelection, type CollectionSimulation } from '../echomindResources';
import type { ProductClient } from '../productClient';
import { DebugExecutionAdoption } from './DebugExecutionAdoption';
import { DemoImageCollection } from './DemoImageCollection';
import { ExecutionPlanConsolidation } from './ExecutionPlanConsolidation';
import { ProductionFlywheel } from './ProductionFlywheel';
import { ProjectReportViewer } from './ProjectReportViewer';
import { ProjectRuntimeResources, type CollectionState } from './ProjectRuntimeResources';
import { ProjectModelOperations } from './ProjectModelOperations';
import {
  ACTIVE_GRAPH_RUN_STATUSES,
  collectRunInputs,
  graphRunStatusLabel,
  pendingArtifactVerificationTask,
  reconcileRunInputs,
  selectProductionRun,
  stageRunStatusLabel,
  type DebugExecutionAdoptionPreview,
  type FullProjectInfo,
  type GraphRepairProposal,
  type GraphRun,
  type GraphRunDetail,
  type PublicationIssue,
  type PublishedGraph,
  type RuntimeContractUpgradeDraft,
  type TaskRun,
} from '../echomindRuntime';

const INPUT_LABELS: Record<string, string> = {
  data: '数据目录',
  source_batch: '图片或已确认批次目录',
  base_model: '基础模型',
};

const DEBUG_EXECUTORS = new Set(['contract_probe', 'artifact_replay']);
const ACTIVE_RUN_POLL_INTERVAL_MS = 2500;
const VERIFY_ARTIFACT_RETRY_MS = 15000;
const PROVIDER_STATUS_LABELS = {
  pending: '排队中',
  running: '执行中',
  succeeded: '已成功',
  failed: '已失败',
  canceled: '已取消',
} satisfies Record<NonNullable<TaskRun['provider_reported_status']>, string>;

type RunDetailState = { detail?: GraphRunDetail; error?: string };

function needsRuntimeBinding(draft: RuntimeContractUpgradeDraft): boolean {
  return draft.nodes.some(node => DEBUG_EXECUTORS.has(node.executor)
    || (node.type === 'dataset' && !node.config.dataset_runtime));
}

export function ProjectRuntimeWorkbench({
  client,
  projectId,
  projectName,
  requestOptions,
  onClose,
  onProjectChanged,
  onRequestResourceProposal,
  managerWorkbenchHref,
  preferredDebugRunId,
  resourceProposalDisabled = false,
}: {
  client: ProductClient;
  projectId: string;
  projectName: string;
  requestOptions: RequestOptions;
  onClose: () => void;
  onProjectChanged: () => void | Promise<void>;
  onRequestResourceProposal?: (text: string) => Promise<boolean>;
  managerWorkbenchHref?: (preferredDebugRunId?: string) => string;
  preferredDebugRunId?: string;
  resourceProposalDisabled?: boolean;
}) {
  const generation = useRef(0);
  const runDetailsSection = useRef<HTMLElement>(null);
  const manualActionRevision = useRef(0);
  const artifactVerification = useRef<{
    runId: string;
    taskId: string;
    retryAt: number;
    inFlight: boolean;
  } | null>(null);
  const [draft, setDraft] = useState<RuntimeContractUpgradeDraft | null>(null);
  const [project, setProject] = useState<FullProjectInfo | null>(null);
  const [publication, setPublication] = useState<PublishedGraph | null>(null);
  const [runs, setRuns] = useState<GraphRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [historyRunId, setHistoryRunId] = useState('');
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const [reportCatalog, setReportCatalog] = useState<{reports: ModelEvaluationRecord[]; error: string; loading: boolean} | null>(null);
  const onReportsChanged = useCallback((reports: ModelEvaluationRecord[], error: string, loading: boolean) => {
    setReportCatalog({reports, error, loading});
  }, []);
  const [runDetails, setRunDetails] = useState<Record<string, RunDetailState>>({});
  const [collectionState, setCollectionState] = useState<CollectionState | null>(null);
  const collection = collectionState?.simulation;
  const previousDemo = demoCollectionSelection(collection) ? collection : collectionState?.lastDemo;
  const demoSeed = collectionState?.demoSeed;
  const [submittedCollection, setSubmittedCollection] = useState<CollectionSimulation | null>(null);
  const [repairProposal, setRepairProposal] = useState<GraphRepairProposal | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [repairRefresh, setRepairRefresh] = useState(0);
  const [runInputs, setRunInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contractError, setContractError] = useState<string | null>(null);
  const [runHistoryError, setRunHistoryError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [readyResourceReleaseId, setReadyResourceReleaseId] = useState<string | null>(null);

  const runInputDefinitions = useMemo(
    () => collectRunInputs(publication?.nodes ?? draft?.nodes ?? []),
    [publication, draft],
  );
  const isFrozen = project?.project.lifecycle === 'frozen';
  const activeRun = runs.find(run => ACTIVE_GRAPH_RUN_STATUSES.has(run.status)) ?? null;
  const consolidationScope = 'echomind-generation:' + JSON.stringify([
    project?.project.owner_user_id, requestOptions.userId, project?.project.cluster, requestOptions.xCluster, projectId,
  ]);
  const needsBinding = draft !== null && needsRuntimeBinding(draft);
  const adoptedPlanStale = draft?.issues.some(issue => issue.code === 'adopted_debug_execution_stale');
  const reviewedContract = draft && !needsBinding && !draft.issues.length ? {
    expected_contract_sha256: draft.content_sha256,
    validation_project_id: draft.validation_project_id ?? undefined,
  } : null;
  const resourceReleaseId = reviewedContract ? draft?.resource_release_id ?? null : null;
  const resourcesReady = !!resourceReleaseId && readyResourceReleaseId === resourceReleaseId;
  const goToResources = () => {
    const section = document.getElementById('project-runtime-resources');
    section?.focus({preventScroll: true});
    section?.scrollIntoView({block: 'start'});
  };
  const activeRunId = activeRun?.run_id;
  const productionReleaseId = publication?.publication_mode === 'production' ? publication.release_id : undefined;
  const datasetConfig = publication?.nodes.find(node => node.type === 'dataset')?.config;
  const validationSource = datasetConfig?.batch_validation_source;
  const productionRun = productionReleaseId ? selectProductionRun(runs, productionReleaseId) : undefined;
  const collectionBeforeRun = collection?.auto_start_graph_run
    && !collection.graph_run_ids.some(id => runs.some(run => run.run_id === id))
    && (!productionRun || (!ACTIVE_GRAPH_RUN_STATUSES.has(productionRun.status)
      && collection.created_at && collection.created_at > productionRun.created_at)) ? collection : null;
  const productionHistory = runs.filter(run => run.execution_mode !== 'debug');
  const historicalRun = productionHistory.find(run => run.run_id === historyRunId);
  const flywheelRun = historicalRun ?? (collectionBeforeRun ? undefined : productionRun);
  const flywheelDetail = flywheelRun ? runDetails[flywheelRun.run_id] : undefined;
  const roundReport = flywheelRun && reportCatalog?.reports.find(report =>
    report.run_id === flywheelRun.run_id,
  );
  const selectedDetail = selectedRunId ? runDetails[selectedRunId] : undefined;
  const runDetail = selectedDetail?.detail;
  const missingSelectedDetail = selectedRunId && selectedRunId !== activeRunId && !selectedDetail ? selectedRunId : null;
  const missingFlywheelDetail = flywheelRun && flywheelRun.run_id !== activeRunId && !flywheelDetail
    ? flywheelRun.run_id : null;
  const selectedRun = runDetail?.run;
  const debugRunToAdopt = draft?.adopted_debug_run?.run_id
    ?? (selectedRun?.execution_mode === 'debug' && selectedRun.status === 'succeeded' ? selectedRun.run_id : undefined)
    ?? runs.find(run => run.execution_mode === 'debug' && run.status === 'succeeded')?.run_id;
  const repairingRunId = selectedRun?.status === 'paused' && selectedRun.repair_handoffs?.some(
    handoff => handoff.delivered_at && selectedRun.current_stage_ids.includes(handoff.stage_run_id),
  ) ? selectedRun.run_id : null;

  const loadRunDetail = useCallback(async (runId: string) => {
    const epoch = generation.current;
    const detail = await client.getGraphRun(projectId, runId, requestOptions);
    if (generation.current !== epoch) return;
    setSelectedRunId(runId);
    setRunDetails(current => ({ ...current, [runId]: {detail} }));
  }, [client, projectId, requestOptions]);

  const refreshStartedRun = useCallback((runId: string) => {
    if (runs.some(run => run.run_id === runId)) return;
    const epoch = generation.current;
    void client.listGraphRuns(projectId, requestOptions).then(nextRuns => {
      if (generation.current !== epoch) return;
      setRuns(nextRuns);
      const newest = nextRuns.find(run => ACTIVE_GRAPH_RUN_STATUSES.has(run.status)) ?? nextRuns[0];
      setSelectedRunId(current => current ?? newest?.run_id ?? null);
    }).catch(failure => {
      if (generation.current === epoch) setRunHistoryError(messageOf(failure));
    });
  }, [client, projectId, requestOptions, runs]);

  const loadProject = useCallback(async (nextProject: FullProjectInfo, epoch = generation.current) => {
    const id = nextProject.project.project_id;
    const frozen = nextProject.project.lifecycle === 'frozen';
    if (generation.current !== epoch) return;
    setProject(nextProject);
    setContractError(null);
    setRunHistoryError(null);
    const loadContract = async () => {
      const [nextDraft, nextPublication] = await Promise.all([
        frozen ? null : client.runtimeContractDraft(id, requestOptions),
        frozen ? client.getPublication(id, requestOptions) : null,
      ]);
      if (generation.current !== epoch) return;
      setDraft(nextDraft);
      setPublication(nextPublication);
      setRunInputs(reconcileRunInputs(nextPublication?.nodes ?? nextDraft?.nodes ?? [], {}));
    };
    const loadHistory = async () => {
      const nextRuns = await client.listGraphRuns(id, requestOptions);
      if (generation.current !== epoch) return;
      setRuns(nextRuns);
      const firstRun = nextRuns.find(run => ACTIVE_GRAPH_RUN_STATUSES.has(run.status)) ?? nextRuns[0];
      setSelectedRunId(firstRun?.run_id ?? null);
    };
    await Promise.all([
      loadContract().catch(failure => {
        if (generation.current === epoch) setContractError(messageOf(failure));
      }),
      loadHistory().catch(failure => {
        if (generation.current === epoch) setRunHistoryError(messageOf(failure));
      }),
    ]);
  }, [client, requestOptions]);

  useEffect(() => {
    const epoch = ++generation.current;
    setLoading(true);
    setError(null);
    setNotice(null);
    setDraft(null);
    setProject(null);
    setPublication(null);
    setRuns([]);
    setSelectedRunId(null);
    setHistoryRunId('');
    setOpenReportId(null);
    setReportCatalog(null);
    setRunDetails({});
    setCollectionState(null);
    setSubmittedCollection(null);
    void (async () => {
      const project = await client.getProject(projectId, requestOptions);
      if (generation.current === epoch) await loadProject(project, epoch);
    })().catch(failure => {
      if (generation.current === epoch) setError(messageOf(failure));
    }).finally(() => {
      if (generation.current === epoch) setLoading(false);
    });
    return () => {
      generation.current += 1;
    };
  }, [client, loadProject, projectId, requestOptions]);

  useEffect(() => {
    if (busyAction) return;
    const runIds = [...new Set([missingSelectedDetail, missingFlywheelDetail])].filter(id => id !== null);
    if (!runIds.length) return;
    let disposed = false;
    const epoch = generation.current;
    void Promise.allSettled(runIds.map(id => client.getGraphRun(projectId, id, requestOptions))).then(results => {
      if (disposed || generation.current !== epoch) return;
      const details = Object.fromEntries(results.map((result, index) => [runIds[index],
        result.status === 'fulfilled' ? {detail: result.value} : {error: messageOf(result.reason)},
      ]));
      setRunDetails(current => ({ ...current, ...details }));
    });
    return () => { disposed = true; };
  }, [busyAction, client, missingFlywheelDetail, missingSelectedDetail, projectId, requestOptions]);

  useEffect(() => {
    if (!activeRunId || busyAction) return;

    let cancelled = false;
    let requestInFlight = false;
    const epoch = generation.current;
    const actionRevision = manualActionRevision.current;
    const isCurrent = () => !cancelled && generation.current === epoch
      && manualActionRevision.current === actionRevision;
    const refreshActiveRun = async () => {
      if (requestInFlight || !isCurrent()) return;
      requestInFlight = true;
      try {
        const detail = await client.getGraphRun(projectId, activeRunId, requestOptions);
        if (!isCurrent()) return;
        setRunDetails(current => ({ ...current, [activeRunId]: {detail} }));
        setRuns(current => current.map(
          run => run.run_id === detail.run.run_id ? detail.run : run,
        ));
        const task = pendingArtifactVerificationTask(detail);
        const previous = artifactVerification.current;
        if (!task || (previous?.runId === activeRunId && (
          previous.inFlight || (previous.taskId === task.task_run_id && previous.retryAt > Date.now())
        ))) return;
        const attempt = {runId: activeRunId, taskId: task.task_run_id, retryAt: 0, inFlight: true};
        artifactVerification.current = attempt;
        try {
          await client.advanceGraphRun(projectId, activeRunId, requestOptions);
        } finally {
          attempt.inFlight = false;
          attempt.retryAt = Date.now() + VERIFY_ARTIFACT_RETRY_MS;
        }
      } catch (failure) {
        if (isCurrent()) setRunDetails(current => current[activeRunId]?.detail
          ? current : { ...current, [activeRunId]: {error: messageOf(failure)} });
      } finally {
        requestInFlight = false;
      }
    };

    void refreshActiveRun();
    const timer = window.setInterval(() => {
      void refreshActiveRun();
    }, ACTIVE_RUN_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    activeRunId,
    busyAction,
    client,
    projectId,
    requestOptions,
  ]);

  useEffect(() => {
    setRepairProposal(null);
    setRepairError(null);
    if (!repairingRunId) return;
    let cancelled = false;
    let timer: number | undefined;
    const refreshProposal = async () => {
      try {
        const proposal = await client.getGraphRepairProposal(projectId, repairingRunId, requestOptions);
        if (!cancelled) {
          setRepairProposal(proposal);
          setRepairError(null);
          if (!proposal) timer = window.setTimeout(() => void refreshProposal(), 5000);
        }
      } catch (failure) {
        if (!cancelled) setRepairError(messageOf(failure));
      }
    };
    void refreshProposal();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [client, projectId, repairingRunId, repairRefresh, requestOptions]);

  const runAction = async (name: string, action: () => Promise<void>) => {
    if (busyAction) return;
    manualActionRevision.current += 1;
    setBusyAction(name);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusyAction(null);
    }
  };

  const reviewRecipe = (validationProjectId?: string) => runAction('draft', async () => {
    const nextDraft = await client.runtimeContractDraft(projectId, requestOptions, validationProjectId);
    setDraft(nextDraft);
    setRunInputs(current => reconcileRunInputs(
      nextDraft.nodes, current, draft?.validation_project_id !== nextDraft.validation_project_id,
    ));
  });

  const adoptDebugExecution = (preview: DebugExecutionAdoptionPreview) => runAction('adopt-debug', async () => {
    const adopted = await client.adoptDebugExecution(projectId, preview, requestOptions);
    setDraft(adopted);
    setRunInputs(current => reconcileRunInputs(adopted.nodes, current, true));
    setNotice(`已采用调试 ${preview.source.run_id.slice(0, 8)} 的执行方案。接下来搭建 Inference 和 Tracer。`);
    if (adopted.resource_release_id) window.requestAnimationFrame(goToResources);
  });

  const publishProject = () => runAction('publish', async () => {
    if (!reviewedContract || !resourcesReady) return;
    await client.publishProject(projectId, requestOptions, reviewedContract);
    await loadProject(await client.getProject(projectId, requestOptions));
    await onProjectChanged();
    setNotice('当前 Project 已发布。');
  });

  const startRun = () => runAction('start-run', async () => {
    if (!isFrozen && !reviewedContract) return;
    const missing = runInputDefinitions.filter(input => !(runInputs[input.name] ?? '').trim());
    if (missing.length) {
      throw new Error(`请填写运行输入：${missing.map(input => inputLabel(input.name)).join('、')}`);
    }
    const requestId = crypto.randomUUID();
    const inputs = Object.fromEntries(runInputDefinitions.map(input => [input.name, runInputs[input.name].trim()]));
    const run = reviewedContract
      ? await client.startDebugGraphRun(projectId, requestId, inputs, reviewedContract, requestOptions)
      : await client.startGraphRun(projectId, requestId, inputs, requestOptions);
    await loadRunDetail(run.run_id);
    setRuns(await client.listGraphRuns(projectId, requestOptions));
    setNotice(isFrozen ? '已开始本轮运行。' : '已开始调试当前执行方案。');
  });

  const advanceRun = () => runAction('advance', async () => {
    if (!runDetail) return;
    await client.advanceGraphRun(projectId, runDetail.run.run_id, requestOptions);
    await loadRunDetail(runDetail.run.run_id);
    setRuns(await client.listGraphRuns(projectId, requestOptions));
  });

  const pauseRun = () => runAction('pause', async () => {
    if (!runDetail) return;
    await client.pauseGraphRun(projectId, runDetail.run.run_id, requestOptions);
    await loadRunDetail(runDetail.run.run_id);
    setRuns(await client.listGraphRuns(projectId, requestOptions));
  });

  const resumeRun = () => runAction('resume', async () => {
    if (!runDetail) return;
    await client.resumeGraphRun(projectId, runDetail.run.run_id, requestOptions);
    await loadRunDetail(runDetail.run.run_id);
    setRuns(await client.listGraphRuns(projectId, requestOptions));
  });

  const retryRun = () => runAction('retry', async () => {
    if (!runDetail) return;
    await client.retryGraphRun(projectId, runDetail.run.run_id, undefined, requestOptions);
    await loadRunDetail(runDetail.run.run_id);
    setRuns(await client.listGraphRuns(projectId, requestOptions));
    setNotice('已使用本轮原输入重试失败节点。');
  });

  const cancelRun = () => runAction('cancel', async () => {
    if (!runDetail) return;
    await client.cancelGraphRun(projectId, runDetail.run.run_id, requestOptions);
    await loadRunDetail(runDetail.run.run_id);
    setRuns(await client.listGraphRuns(projectId, requestOptions));
  });

  const requestRepair = (reviseInvalidProposal = false) => runAction('request-repair', async () => {
    if (!selectedRun) return;
    await client.requestGraphRepair(projectId, selectedRun.run_id, requestOptions, reviseInvalidProposal);
    await loadRunDetail(selectedRun.run_id);
    setRepairRefresh(count => count + 1);
    setNotice(reviseInvalidProposal ? '已将提案校验结果交给 Project Agent。' : '已将失败记录交给 Project Agent。');
  });

  const startRepairDebug = () => runAction('repair-debug', async () => {
    if (!repairingRunId || !repairProposal) return;
    const run = await client.startGraphRepairDebug(
      projectId, repairingRunId, repairProposal.content_sha256, requestOptions,
    );
    await loadRunDetail(run.run_id);
    setRuns(await client.listGraphRuns(projectId, requestOptions));
    setNotice('已用修复方案开始新一轮调试。');
  });

  const reopenProject = () => runAction('reopen', async () => {
    await loadProject(await client.reopenProject(projectId, requestOptions));
    await onProjectChanged();
    setNotice('当前 Project 已回到开发态，历史 Release 仍可查看。');
  });

  const openRunRecord = (runId: string) => {
    setSelectedRunId(runId);
    if (runDetails[runId]?.error) {
      setRunDetails(current => {
        const next = {...current};
        delete next[runId];
        return next;
      });
    }
    runDetailsSection.current?.focus({preventScroll: true});
    runDetailsSection.current?.scrollIntoView({block: 'start'});
  };

  return <section aria-label="调试与发布" className="flex max-h-[62vh] min-h-[420px] shrink-0 flex-col border-b-4 border-slate-300 bg-slate-100">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="rounded bg-emerald-700 px-2 py-1 text-xs font-semibold text-white">Runtime</span>
        <div className="min-w-0">
          <h2 className="truncate font-semibold">调试与发布 · {projectName}</h2>
          <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">Project {projectId}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border bg-slate-50 px-2 py-1 text-[10px] text-slate-600">{isFrozen ? 'PublishedGraph' : 'WorkingGraph · development'}</span>
        <button type="button" onClick={onClose} className="rounded border bg-white px-3 py-1 text-xs text-slate-700">返回阶段工作台</button>
      </div>
    </header>

    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {error && <div role="alert" className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>}
      {notice && <div role="status" className="mt-3 rounded border border-emerald-200 bg-white px-3 py-2 text-xs text-emerald-800">{notice}</div>}
      {loading && <p role="status" className="mt-3 text-sm text-slate-500">正在读取执行方案与运行记录…</p>}
      {contractError && <div role="alert" className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">执行方案读取失败。{contractError}</div>}

      {project && <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        {productionReleaseId && <ProductionFlywheel run={flywheelRun} detail={flywheelDetail?.detail}
          detailError={flywheelDetail?.error} simulation={historicalRun ? null : collectionBeforeRun}
          actions={<>
            <label className="flex items-center gap-2 text-xs text-slate-600">历史轮次
              <select value={historicalRun?.run_id ?? ''} disabled={!productionHistory.length} onChange={event => {
                const id = event.target.value;
                setHistoryRunId(id);
                setOpenReportId(null);
                setSelectedRunId(id || (collectionBeforeRun ? null : productionRun?.run_id ?? null));
              }} className="max-w-full rounded border border-slate-300 bg-white px-2 py-1.5">
                <option value="">{productionHistory.length ? '当前进度' : runHistoryError ? '轮次读取失败' : loading ? '正在读取…' : '暂无历史轮次'}</option>
                {productionHistory.map(run => <option key={run.run_id} value={run.run_id}>
                  第 {run.round_no} 轮 · {graphRunStatusLabel(run.status)} · {new Date(run.created_at).toLocaleString()}
                </option>)}
              </select>
            </label>
            {flywheelRun && (roundReport
              ? <button type="button" onClick={() => setOpenReportId(roundReport.candidate_id)} className="rounded border border-slate-300 px-2.5 py-1.5 text-xs text-blue-700">查看评测报告</button>
              : <span className="text-xs text-slate-500">{!reportCatalog || reportCatalog.loading ? '正在读取报告列表…'
                : reportCatalog.error ? '报告列表读取失败' : '本轮暂无评测报告'}</span>)}
          </>}
          report={roundReport && openReportId === roundReport.candidate_id && <ProjectReportViewer
            key={roundReport.candidate_id} projectId={projectId} candidateId={roundReport.candidate_id}
            requestOptions={requestOptions} onClose={() => setOpenReportId(null)} />}
          onOpenRun={() => flywheelRun && openRunRecord(flywheelRun.run_id)}>
          {!historicalRun && collectionState && demoSeed?.source && <DemoImageCollection key={`${projectId}:${previousDemo?.simulation_id ?? demoSeed.simulation_id}`}
            projectId={projectId} imageRoot={demoSeed.source.image_root} previous={previousDemo} batchSize={collectionState.batchSize} requestOptions={requestOptions}
            datasetLabels={datasetConfig?.batch_label_source === 'dataset'}
            validationSource={validationSource === 'fixed' || validationSource === 'none' ? validationSource : 'batch'}
            disabled={!collectionState.canRunBatch || !!activeRun || !!(collection && collectionSimulationActive(collection)
              && !(collection.manual_start && collection.status === 'pending' && collection.simulation_id !== submittedCollection?.simulation_id))}
            onStarted={value => {
              setCollectionState(current => current && {...current, simulation: value});
              setSubmittedCollection(value);
            }} />}
        </ProductionFlywheel>}
        {draft && <section aria-label="Runtime Contract" className="min-w-0 rounded-lg border bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">执行契约审阅</h3>
              <p className="mt-1 text-xs text-slate-500">先确定执行方案，再搭建常驻资源。资源就绪后可以正式发布。</p>
            </div>
            <button type="button" disabled={busyAction !== null} onClick={() => void reviewRecipe(draft.validation_project_id ?? undefined)} className="rounded border px-2.5 py-1.5 text-xs disabled:opacity-50">重新检查</button>
          </div>
          {!draft.adopted_debug_run && !!draft.validation_candidates?.length && <label className="mt-3 block text-xs text-slate-600">
            <span className="font-medium">执行方案</span>
            <select className="mt-1 block w-full rounded border bg-white p-2" disabled={busyAction !== null} value={draft.validation_project_id ?? ''} onChange={event => void reviewRecipe(event.target.value || undefined)}>
              <option value="">当前 Project 配置</option>
              {draft.validation_candidates.map(candidate => <option key={candidate.project_id} value={candidate.project_id}>{candidate.name}</option>)}
            </select>
          </label>}
          {draft.adopted_debug_run && <p className="mt-3 rounded bg-emerald-50 p-2 text-xs text-emerald-900">{adoptedPlanStale ? '执行方案需要重新审阅。上次采用的调试' : '当前执行方案来自调试'} <code>{draft.adopted_debug_run.run_id.slice(0, 8)}</code></p>}
          <p className="mt-2 break-all font-mono text-[10px] text-slate-500">{draft.content_sha256}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
            {draft.nodes.map(node => <NodeContractCard key={node.id} node={node} />)}
          </div>
          <IssueList title="阻塞项" issues={draft.issues} empty="没有阻塞项" />
          <AssumptionList draft={draft} />
          {project && !isFrozen && <ExecutionPlanConsolidation key={consolidationScope} storageKey={consolidationScope} client={client}
            projectId={projectId} options={requestOptions} disabled={!!busyAction || !!activeRun}
            onApply={async nextProject => {
              await loadProject(nextProject);
              await onProjectChanged();
              setNotice('执行方案已应用到当前 Project。可以开始调试，或继续搭建常驻资源。');
            }}
            renderDraft={candidate => <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
              {candidate.nodes.map(node => <NodeContractCard key={node.id} node={node} />)}
            </div>} />}
          <DebugExecutionAdoption client={client} projectId={projectId} requestOptions={requestOptions}
            disabled={busyAction !== null || activeRun !== null}
            revision={`${draft.content_sha256}:${runs.find(run => run.status === 'succeeded' && run.execution_mode === 'debug')?.run_id ?? ''}`}
            adopted={adoptedPlanStale ? null : draft.adopted_debug_run} preferredRunId={preferredDebugRunId}
            onAdopt={preview => void adoptDebugExecution(preview)} />
          {resourceReleaseId && !resourcesReady && <button type="button" onClick={goToResources} className="mt-4 rounded border border-blue-200 px-3 py-2 text-xs font-medium text-blue-800">下一步：搭建常驻资源</button>}
        </section>}

        {publication && <section aria-label="当前发布版本" className="rounded-lg border bg-white p-4">
          <h3 className="text-sm font-semibold">当前发布版本</h3>
          <dl className="mt-3 grid gap-2 text-xs">
            <InfoRow label="Active Release" value={publication.release_id} mono />
            <InfoRow label="发布模式" value={publication.publication_mode} />
            {publication.adopted_debug_run && <InfoRow label="来源调试" value={publication.adopted_debug_run.run_id} mono />}
            {project.project.source_project_id && <InfoRow label="源 Project" value={project.project.source_project_id} mono />}
          </dl>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" disabled={busyAction !== null || activeRun !== null} onClick={() => void reopenProject()} className="rounded border px-3 py-2 text-xs disabled:opacity-40">重开开发态</button>
          </div>
        </section>}

        <section ref={runDetailsSection} tabIndex={-1} aria-label="GraphRun 执行" className="rounded-lg border bg-white p-4">
          <h3 className="text-sm font-semibold">运行与产物</h3>
          {runHistoryError && <p role="alert" className="mt-2 text-xs text-red-800">运行记录读取失败。{runHistoryError}</p>}
          <div className="mt-3 grid gap-2">
            {runInputDefinitions.map(input => <label key={input.name} className="block">
              <span className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-slate-600">
                <span>{inputLabel(input.name)} <span className="font-normal text-slate-400">{input.usedBy.join(' · ')}</span></span>
                <span className="font-mono text-[10px] text-slate-400">{input.artifactType}</span>
              </span>
              <input disabled={busyAction !== null} value={runInputs[input.name] ?? ''} onChange={event => setRunInputs(current => ({...current, [input.name]: event.target.value}))} placeholder={input.defaultValue || input.name} className="w-full rounded border px-3 py-2 font-mono text-xs outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-500" />
            </label>)}
          </div>
          <div className="mt-3 flex flex-wrap justify-between gap-2">
            <select aria-label="GraphRun 历史" value={selectedRunId ?? ''} onChange={event => { const runId = event.target.value; if (runId) void runAction('load-run', () => loadRunDetail(runId)); }} className="min-w-0 flex-1 rounded border bg-white px-2 py-2 text-xs">
              <option value="">执行历史 {runs.length ? `(${runs.length})` : ''}</option>
              {runs.map(run => <option key={run.run_id} value={run.run_id}>{run.execution_mode === 'debug' ? '调试' : '生产运行'} {run.round_no} · {graphRunStatusLabel(run.status)} · {run.run_id.slice(0, 8)}</option>)}
            </select>
            <button type="button" disabled={busyAction !== null || activeRun !== null || (!isFrozen && !reviewedContract)} onClick={() => void startRun()} className="rounded bg-blue-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-40" title={activeRun ? `当前存在活跃 Run：${activeRun.run_id}` : undefined}>{busyAction === 'start-run' ? '正在启动…' : isFrozen ? '开始新一轮' : '开始调试'}</button>
          </div>
          {selectedDetail?.error && <p role="status" className="mt-2 text-xs text-slate-600">节点状态读取失败。{selectedDetail.error}</p>}
          {runDetail && <RunDetail detail={runDetail} busy={busyAction !== null} onAdvance={() => void advanceRun()} onPause={() => void pauseRun()} onResume={() => void resumeRun()} onRetry={() => void retryRun()} onCancel={() => void cancelRun()} onRepair={() => void requestRepair()} repairing={repairingRunId !== null} repairProposal={repairProposal} repairError={repairError} onRefreshRepair={() => setRepairRefresh(count => count + 1)} onReviseRepair={() => void requestRepair(true)} onRepairDebug={() => void startRepairDebug()} />}
        </section>
        <ProjectRuntimeResources key={publication?.release_id ?? resourceReleaseId ?? 'unconfigured'}
          projectId={projectId} requestOptions={requestOptions} published={publication} stagingReleaseId={resourceReleaseId} canRunCollectionBatch
          onResourcesReady={setReadyResourceReleaseId} onRequestResourceProposal={onRequestResourceProposal} resourceProposalDisabled={resourceProposalDisabled}
          onCollectionChanged={setCollectionState} submittedCollection={submittedCollection}
          managerWorkbenchHref={debugRunToAdopt || !loading ? managerWorkbenchHref?.(debugRunToAdopt) : undefined}
          onGraphRunStarted={refreshStartedRun} />
        <ProjectModelOperations key={projectId} projectId={projectId} requestOptions={requestOptions}
          onReportsChanged={onReportsChanged} onOpenRun={openRunRecord} />
        {draft && <section aria-label="正式发布" className="min-w-0 rounded-lg border bg-white p-4">
          <h3 className="text-sm font-semibold">正式发布</h3>
          <p className="mt-2 text-xs text-slate-600">{resourcesReady ? 'Inference 和 Tracer 已就绪。发布后可运行一轮采集验收。' : 'Inference 和 Tracer 通过健康检查后，才可以发布。'}</p>
          <button type="button" disabled={busyAction !== null || activeRun !== null || !resourcesReady} onClick={() => void publishProject()} className="mt-3 rounded bg-emerald-700 px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">
            {busyAction === 'publish' ? '正在发布…' : '发布此方案'}
          </button>
        </section>}
      </div>}
    </div>
  </section>;
}

function NodeContractCard({ node }: { node: RuntimeContractUpgradeDraft['nodes'][number] }) {
  return <article className="min-w-0 rounded border bg-slate-50 p-3">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0"><h4 className="truncate text-xs font-semibold">{node.title}</h4><p className="mt-0.5 font-mono text-[10px] text-slate-500">{node.id} · {node.executor}</p></div>
      <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-500">{node.type}</span>
    </div>
    <dl className="mt-2 space-y-1 text-[11px]">
      {Object.entries(node.inputs).map(([name, input]) => <div key={name} className="flex min-w-0 gap-1.5"><dt className="shrink-0 text-slate-400">输入</dt><dd className="min-w-0 break-all text-slate-600">{name} ← {bindingLabel(input.binding.kind, input.binding.node_id, input.binding.port, input.binding.name)}</dd></div>)}
      {Object.keys(node.outputs).map(name => <div key={name} className="flex min-w-0 gap-1.5"><dt className="shrink-0 text-emerald-600">输出</dt><dd className="min-w-0 break-all text-slate-600">{name}</dd></div>)}
    </dl>
  </article>;
}

function RunDetail({
  detail,
  busy,
  onAdvance,
  onPause,
  onResume,
  onRetry,
  onCancel,
  onRepair,
  repairing,
  repairProposal,
  repairError,
  onRefreshRepair,
  onReviseRepair,
  onRepairDebug,
}: {
  detail: GraphRunDetail;
  busy: boolean;
  onAdvance: () => void;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onRepair: () => void;
  repairing: boolean;
  repairProposal: GraphRepairProposal | null;
  repairError: string | null;
  onRefreshRepair: () => void;
  onReviseRepair: () => void;
  onRepairDebug: () => void;
}) {
  const run = detail.run;
  const active = ACTIVE_GRAPH_RUN_STATUSES.has(run.status);
  const canRetry = run.status === 'paused'
    && Boolean(run.failure)
    && detail.stage_runs.some(stage => stage.status === 'failed');
  return <div className="mt-4 border-t pt-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="text-xs font-semibold">{run.execution_mode === 'debug' ? '调试' : '生产运行'} {run.round_no} · {graphRunStatusLabel(run.status)}</p>
        <p className="mt-1 break-all font-mono text-[10px] text-slate-500">{run.run_id}</p>
        {run.outcome && run.promotion_result?.reason !== 'finalizer_not_configured' && <p className="mt-1 text-[11px] text-slate-500">Outcome · {run.outcome}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {active && run.status !== 'paused' && <button type="button" disabled={busy} onClick={onAdvance} className="rounded border px-2.5 py-1.5 text-[11px] disabled:opacity-40">继续推进</button>}
        {active && run.status !== 'paused' && <button type="button" disabled={busy} onClick={onPause} className="rounded border px-2.5 py-1.5 text-[11px] disabled:opacity-40">暂停</button>}
        {run.status === 'paused' && <button type="button" disabled={busy} onClick={onResume} className="rounded border px-2.5 py-1.5 text-[11px] disabled:opacity-40">恢复</button>}
        {canRetry && <button type="button" disabled={busy} onClick={onRetry} className="rounded bg-amber-600 px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-40">按原输入重试</button>}
        {canRetry && run.execution_mode === 'debug' && !repairing && <button type="button" disabled={busy} onClick={onRepair} className="rounded border border-indigo-200 px-2.5 py-1.5 text-[11px] font-medium text-indigo-700 disabled:opacity-40">交给 Agent 修复</button>}
        {active && <button type="button" disabled={busy} onClick={onCancel} className="rounded border border-red-200 px-2.5 py-1.5 text-[11px] text-red-700 disabled:opacity-40">取消</button>}
      </div>
    </div>
    {run.failure && <p role="alert" className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-[11px] text-red-800">{run.failure.category}: {run.failure.message}</p>}
    {repairing && <div className="mt-2 rounded border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-950">
      {repairError ? <>
        <p role="alert">{repairError}</p>
        <button type="button" disabled={busy} onClick={onRefreshRepair} className="mt-2 mr-2 rounded border border-indigo-300 px-3 py-1.5 font-medium disabled:opacity-40">重新读取提案</button>
        {repairError.includes('字段格式不正确') && <button type="button" disabled={busy} onClick={onReviseRepair} className="mt-2 rounded border border-indigo-300 px-3 py-1.5 font-medium disabled:opacity-40">让 Agent 修订提案</button>}
      </> : repairProposal ? <>
        <p className="font-semibold">{repairProposal.node_id} · Agent 修复方案</p>
        <p className="mt-1 whitespace-pre-wrap break-words">{repairProposal.reason}</p>
        <button type="button" disabled={busy} onClick={onRepairDebug} className="mt-2 rounded bg-indigo-700 px-3 py-1.5 font-medium text-white disabled:opacity-40">用修复方案调试</button>
      </> : <p role="status">等待 Project Agent 提交修复方案，可在对话中查看进度。</p>}
    </div>}
    <ol aria-label="GraphRun 节点时间线" className="mt-3 space-y-2">
      {detail.stage_runs.map(stage => <li key={stage.run_id} className="rounded border bg-slate-50 p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong>{stage.node_id}</strong>
          <div className="flex items-center gap-2">
            {stage.reused_from_stage_run_id && <span className="text-[10px] text-slate-500">复用上轮产物</span>}
            <span className={`rounded px-2 py-0.5 text-[10px] ${stageStatusClass(stage.status)}`}>{stageRunStatusLabel(stage.status)}</span>
          </div>
        </div>
        <p className="mt-1 text-slate-600">{stage.message}</p>
        {stage.error && <p className="mt-1 text-red-700">{stage.error}</p>}
        {!!stage.input_refs.length && <RefList label="输入" refs={stage.input_refs} />}
        {!!stage.output_refs.length && <RefList label="输出" refs={stage.output_refs.map(ref => typeof ref.metadata.source_uri === 'string' ? ref.metadata.source_uri : ref.uri)} />}
        {!!stage.task_runs.length && <ul aria-label="平台任务" className="mt-1 space-y-1 text-[10px] text-slate-600">
          {stage.task_runs.map(task => <li key={task.task_run_id}>
            {task.provider_run_id ? `平台任务 ${task.provider_run_id}` : task.provider} · {task.status}
            {task.provider_reported_status && task.provider_reported_status !== task.status && <span>
              {' · 平台回调'}{PROVIDER_STATUS_LABELS[task.provider_reported_status]}
              {task.provider_reported_status === 'succeeded' && !task.finished_at && '，等待校验产物'}
            </span>}
          </li>)}
        </ul>}
      </li>)}
    </ol>
  </div>;
}

function RefList({ label, refs }: { label: string; refs: string[] }) {
  return <div className="mt-2"><p className="text-[10px] font-medium text-slate-500">{label}</p><ul className="mt-1 space-y-1">{refs.map((ref, index) => <li key={`${ref}:${index}`} className="break-all rounded bg-white px-2 py-1 font-mono text-[10px] text-slate-600">{ref}</li>)}</ul></div>;
}

function AssumptionList({ draft }: { draft: RuntimeContractUpgradeDraft }) {
  if (!draft.assumptions.length) return null;
  return <details className="mt-3 rounded border bg-amber-50 p-3 text-xs text-amber-900">
    <summary className="cursor-pointer font-medium">执行假设 · {draft.assumptions.length}</summary>
    <ul className="mt-2 space-y-1.5">{draft.assumptions.map((item, index) => <li key={`${item.code}:${item.node_id ?? ''}:${index}`} className="break-words"><span className="font-mono text-[10px] text-amber-700">{item.code}</span><br />{item.message}</li>)}</ul>
  </details>;
}

function IssueList({ title, issues, empty }: { title: string; issues: PublicationIssue[]; empty: string }) {
  return <div className={`mt-3 rounded border p-3 text-xs ${issues.length ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
    <p className="font-medium">{title} · {issues.length}</p>
    {issues.length ? <ul className="mt-2 space-y-1">{issues.map((issue, index) => <li key={`${issue.code}:${issue.node_id ?? ''}:${index}`}>{issue.node_id ? `${issue.node_id} · ` : ''}{issue.message}</li>)}</ul> : <p className="mt-1">{empty}</p>}
  </div>;
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-2"><dt className="text-slate-400">{label}</dt><dd className={`min-w-0 break-all text-slate-700 ${mono ? 'font-mono text-[10px]' : ''}`}>{value}</dd></div>;
}

function bindingLabel(kind: string, nodeId?: string | null, port?: string | null, name?: string | null): string {
  if (kind === 'node_output') return `${nodeId}.${port}`;
  if (kind === 'run_input') return `每次运行 · ${name ?? ''}`;
  if (kind === 'runtime_slot') return `运行资源 · ${name ?? ''}`;
  return `固定值 · ${name ?? kind}`;
}

function inputLabel(name: string): string {
  return INPUT_LABELS[name] ? `${INPUT_LABELS[name]} (${name})` : name;
}

function stageStatusClass(status: GraphRunDetail['stage_runs'][number]['status']): string {
  if (status === 'succeeded') return 'bg-emerald-100 text-emerald-800';
  if (status === 'failed') return 'bg-red-100 text-red-800';
  if (status === 'waiting_external' || status === 'waiting_user' || status === 'paused') return 'bg-amber-100 text-amber-800';
  if (status === 'running' || status === 'clarifying') return 'bg-blue-100 text-blue-800';
  return 'bg-slate-200 text-slate-700';
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
