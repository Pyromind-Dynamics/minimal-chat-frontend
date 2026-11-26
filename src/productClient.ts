import type { ObservationOverview, ObservationReportDetails, ObservationReportQuery, SeriesPage, SeriesQuery } from './observationsContract';
import { productRequest, type RequestOptions } from './api';
import { BACKEND_URL, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL } from './config';
import { PROJECTS_PATH, type ProjectSummary } from './echomindContract';
import type {
  ConsolidationGeneration,
  ConsolidationJob,
  ConsolidationReview,
  ConsolidationState,
  ConsolidationTaskIds,
  DebugExecutionAdoptionPreview,
  DebugExecutionCandidate,
  FullProjectInfo,
  GraphRepairProposal,
  GraphRun,
  GraphRunDetail,
  PublicationPreflight,
  PublishedGraph,
  PublishedGraphDraft,
  ReviewedRuntimeContract,
  RuntimeContractApplication,
  RuntimeContractUpgradeDraft,
  RuntimeImplementationAdoption,
} from './echomindRuntime';
import type { CommandReceipt, ConversationSnapshot, ConversationSummary } from './types';

const READ_TIMEOUT_MS = 20_000;
// Generation may recheck two Sandbox batches for up to three minutes each.
const CONSOLIDATION_TIMEOUT_MS = 10 * 60_000;

function readProduct<T>(url: string, options: RequestOptions, label: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
  return productRequest<T>(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout }, options)
    .catch(error => {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new Error(`读取${label}超时，请重试。`);
      }
      throw error;
    });
}

export function createProductClient(path: string) {
  const base = `${BACKEND_URL}${path}`;
  const projectBase = (projectId: string) => `${BACKEND_URL}${PROJECTS_PATH}/${encodeURIComponent(projectId)}`;
  const analysisReportUrl = (projectId: string, nodeId: string, reportId: string) => {
    const params = new URLSearchParams({project_node_id: nodeId, report_version_id: reportId});
    return `${projectBase(projectId)}/observations/analysis-report?${params}`;
  };
  const graphRunBase = (projectId: string, runId?: string) => {
    const runs = `${projectBase(projectId)}/graph-runs`;
    return runId ? `${runs}/${encodeURIComponent(runId)}` : runs;
  };
  return {
    create: (options: RequestOptions) => productRequest<ConversationSnapshot>(base, {
      method: 'POST', body: JSON.stringify({ llm: { model: LLM_MODEL || undefined, api_key: LLM_API_KEY || undefined, base_url: LLM_BASE_URL || undefined }, extra: {} }),
    }, options),
    list: (options: RequestOptions, signal?: AbortSignal) => readProduct<ConversationSummary[]>(`${base}/summaries`, options, '对话列表', signal),
    snapshot: (id: string, options: RequestOptions, signal?: AbortSignal) => readProduct<ConversationSnapshot>(`${base}/${encodeURIComponent(id)}/snapshot`, options, '对话', signal),
    deleteConversation: (id: string, options: RequestOptions) =>
      productRequest<{ deleted: boolean }>(`${base}/${encodeURIComponent(id)}`, { method: 'DELETE' }, options),
    project: (id: string, options: RequestOptions, signal?: AbortSignal) => productRequest<{ project: Pick<ProjectSummary, 'project_id' | 'conversation_id' | 'cluster'> }>(`${BACKEND_URL}${PROJECTS_PATH}/${encodeURIComponent(id)}`, { signal }, options),
    command: (id: string, command: Record<string, unknown>, options: RequestOptions) => productRequest<CommandReceipt>(`${base}/${encodeURIComponent(id)}/commands`, { method: 'POST', body: JSON.stringify(command) }, options),
    listProjects: (options: RequestOptions, signal?: AbortSignal) => readProduct<ProjectSummary[]>(`${BACKEND_URL}${PROJECTS_PATH}`, options, '项目列表', signal),
    getProject: (projectId: string, options: RequestOptions) => readProduct<FullProjectInfo>(projectBase(projectId), options, '项目'),
    runtimeContractDraft: (projectId: string, options: RequestOptions, validationProjectId?: string) => {
      const query = validationProjectId ? `?validation_project_id=${encodeURIComponent(validationProjectId)}` : '';
      return readProduct<RuntimeContractUpgradeDraft>(`${projectBase(projectId)}/runtime-contract/draft${query}`, options, '执行方案');
    },
    reviewConsolidation: (projectId: string, taskIds: ConsolidationTaskIds, options: RequestOptions, scriptOnly = false) => {
      const query = new URLSearchParams();
      for (const [stage, id] of Object.entries(taskIds)) {
        if (id.trim()) query.set(`${stage}_task_id`, id.trim());
      }
      if (scriptOnly) query.set('script_only', 'true');
      const suffix = query.size ? `?${query}` : '';
      return readProduct<ConsolidationReview>(`${projectBase(projectId)}/runtime-contract/consolidation${suffix}`, options, '研发执行记录');
    },
    prepareConsolidation: (projectId: string, taskIds: ConsolidationTaskIds, options: RequestOptions, reviewNote?: string) =>
      productRequest<{ command_id: string; proposal_path: string }>(`${projectBase(projectId)}/runtime-contract/consolidation`, {
        method: 'POST', body: JSON.stringify({ task_ids: taskIds, review_note: reviewNote }),
      }, options),
    compileConsolidation: (projectId: string, taskIds: ConsolidationTaskIds, options: RequestOptions, recipePath?: string) => {
      const selected = Object.fromEntries(
        Object.entries(taskIds).map(([stage, id]) => [stage, id.trim()]).filter(([, id]) => id),
      );
      return productRequest<ConsolidationReview>(`${projectBase(projectId)}/runtime-contract/consolidation/compile`, {
        method: 'POST', body: JSON.stringify({ task_ids: selected, recipe_path: recipePath?.trim() || undefined }),
      }, options);
    },
    generateConsolidation: (projectId: string, taskIds: ConsolidationTaskIds, options: RequestOptions, retryCommandId?: string, signal?: AbortSignal, background = false) => {
      const selected = Object.fromEntries(
        Object.entries(taskIds).map(([stage, id]) => [stage, id.trim()]).filter(([, id]) => id),
      );
      const timeout = AbortSignal.timeout(CONSOLIDATION_TIMEOUT_MS);
      return productRequest<ConsolidationGeneration>(`${projectBase(projectId)}/runtime-contract/consolidation/generate`, {
        method: 'POST', body: JSON.stringify({ task_ids: selected, retry_command_id: retryCommandId, ...(background ? {background: true} : {}) }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      }, options);
    },
    consolidationJobs: (projectId: string, options: RequestOptions, signal?: AbortSignal) =>
      readProduct<ConsolidationState>(`${projectBase(projectId)}/consolidation-jobs`, options, '执行方案进度', signal),
    controlConsolidationJob: (projectId: string, job: ConsolidationJob, action: 'pause' | 'resume', options: RequestOptions) =>
      productRequest<ConsolidationJob>(`${projectBase(projectId)}/consolidation-jobs/${encodeURIComponent(job.job_id)}/${action}`, {
        method: 'POST', body: JSON.stringify({command_id: crypto.randomUUID(), expected_revision: job.revision}),
      }, options),
    applyConsolidation: (projectId: string, taskIds: ConsolidationTaskIds, proposalSha: string, options: RequestOptions) =>
      productRequest<FullProjectInfo>(`${projectBase(projectId)}/runtime-contract/consolidation/apply`, {
        method: 'POST', body: JSON.stringify({ task_ids: taskIds, proposal_sha256: proposalSha }),
      }, options),
    listDebugExecutionCandidates: (projectId: string, options: RequestOptions) =>
      readProduct<DebugExecutionCandidate[]>(`${projectBase(projectId)}/runtime-contract/debug-candidates`, options, '通过的调试'),
    previewDebugExecutionAdoption: (projectId: string, sourceProjectId: string, runId: string, options: RequestOptions) => {
      const query = new URLSearchParams({ source_project_id: sourceProjectId, run_id: runId });
      return readProduct<DebugExecutionAdoptionPreview>(`${projectBase(projectId)}/runtime-contract/debug-adoption?${query}`, options, '方案变更');
    },
    adoptDebugExecution: (projectId: string, preview: DebugExecutionAdoptionPreview, options: RequestOptions) =>
      productRequest<RuntimeContractUpgradeDraft>(`${projectBase(projectId)}/runtime-contract/debug-adoption`, {
        method: 'POST',
        body: JSON.stringify({
          source_project_id: preview.source.source_project_id,
          run_id: preview.source.run_id,
          expected_preview_sha256: preview.content_sha256,
        }),
      }, options),
    applyRuntimeContract: (projectId: string, expectedDraftSha256: string, options: RequestOptions, validationProjectId?: string) => productRequest<RuntimeContractApplication>(`${projectBase(projectId)}/runtime-contract/apply`, {
      method: 'POST',
      body: JSON.stringify({ expected_draft_sha256: expectedDraftSha256, validation_project_id: validationProjectId }),
    }, options),
    adoptRuntimeImplementation: (projectId: string, options: RequestOptions) => productRequest<RuntimeImplementationAdoption>(`${projectBase(projectId)}/runtime-implementation/adopt`, {
      method: 'POST',
      body: JSON.stringify({}),
    }, options),
    publicationPreflight: (projectId: string, options: RequestOptions) => productRequest<PublicationPreflight>(`${projectBase(projectId)}/publication/preflight?publication_mode=production`, {}, options),
    compilePublication: (projectId: string, options: RequestOptions) => productRequest<PublishedGraphDraft>(`${projectBase(projectId)}/publication/compile?publication_mode=production`, { method: 'POST' }, options),
    publishProject: (projectId: string, options: RequestOptions, reviewed?: string | ReviewedRuntimeContract) => productRequest<PublishedGraph>(`${projectBase(projectId)}/publish`, {
      method: 'POST',
      body: JSON.stringify({
        publication_mode: 'production',
        ...(typeof reviewed === 'string' ? { expected_draft_sha256: reviewed } : reviewed),
      }),
    }, options),
    getPublication: (projectId: string, options: RequestOptions) => readProduct<PublishedGraph>(`${projectBase(projectId)}/publication`, options, '已发布流程'),
    reopenProject: (projectId: string, options: RequestOptions) => productRequest<FullProjectInfo>(`${projectBase(projectId)}/reopen`, { method: 'POST' }, options),
    listGraphRuns: (projectId: string, options: RequestOptions) => readProduct<GraphRun[]>(graphRunBase(projectId), options, '运行历史'),
    startGraphRun: (projectId: string, requestId: string, inputs: Record<string, unknown>, options: RequestOptions) => productRequest<GraphRun>(graphRunBase(projectId), {
      method: 'POST',
      body: JSON.stringify({ request_id: requestId, inputs }),
    }, options),
    startDebugGraphRun: (projectId: string, requestId: string, inputs: Record<string, unknown>, reviewed: ReviewedRuntimeContract, options: RequestOptions) => productRequest<GraphRun>(`${graphRunBase(projectId)}/debug`, {
      method: 'POST',
      body: JSON.stringify({ request_id: requestId, inputs, ...reviewed }),
    }, options),
    getGraphRun: (projectId: string, runId: string, options: RequestOptions) => readProduct<GraphRunDetail>(graphRunBase(projectId, runId), options, '运行详情'),
    requestGraphRepair: (projectId: string, runId: string, options: RequestOptions, reviseInvalidProposal = false) => productRequest<unknown>(`${graphRunBase(projectId, runId)}/repair`, {
      method: 'POST',
      body: reviseInvalidProposal ? JSON.stringify({ revise_invalid_proposal: true }) : undefined,
    }, options),
    getGraphRepairProposal: (projectId: string, runId: string, options: RequestOptions) => readProduct<GraphRepairProposal | null>(`${graphRunBase(projectId, runId)}/repair/proposal`, options, '修复提案'),
    startGraphRepairDebug: (projectId: string, runId: string, proposalDigest: string, options: RequestOptions) => productRequest<GraphRun>(`${graphRunBase(projectId, runId)}/repair/debug`, {
      method: 'POST', body: JSON.stringify({ expected_proposal_sha256: proposalDigest }),
    }, options),
    advanceGraphRun: (projectId: string, runId: string, options: RequestOptions) => productRequest<GraphRun>(`${graphRunBase(projectId, runId)}/advance`, { method: 'POST' }, options),
    pauseGraphRun: (projectId: string, runId: string, options: RequestOptions) => productRequest<GraphRun>(`${graphRunBase(projectId, runId)}/pause`, { method: 'POST' }, options),
    resumeGraphRun: (projectId: string, runId: string, options: RequestOptions) => productRequest<GraphRun>(`${graphRunBase(projectId, runId)}/resume`, { method: 'POST' }, options),
    retryGraphRun: (projectId: string, runId: string, inputs: Record<string, unknown> | undefined, options: RequestOptions) => productRequest<GraphRun>(`${graphRunBase(projectId, runId)}/retry`, {
      method: 'POST',
      body: JSON.stringify({ inputs }),
    }, options),
    cancelGraphRun: (projectId: string, runId: string, options: RequestOptions) => productRequest<GraphRun>(`${graphRunBase(projectId, runId)}/cancel`, { method: 'POST' }, options),
    inputHtml: (id: string, requestId: string, options: RequestOptions) => productRequest<{html: string}>(`${base}/${encodeURIComponent(id)}/pending-inputs/${encodeURIComponent(requestId)}/html`, {}, options),
    inputMedia: (id: string, requestId: string, contentIndex: number, imageIndex: number, options: RequestOptions) => productRequest<{url: string}>(`${base}/${encodeURIComponent(id)}/pending-inputs/${encodeURIComponent(requestId)}/media/${contentIndex}/${imageIndex}`, {}, options),
    observations: (id: string, options: RequestOptions, signal?: AbortSignal) => productRequest<ObservationOverview>(`${BACKEND_URL}${PROJECTS_PATH}/${encodeURIComponent(id)}/observations/overview`, { signal, cache: 'no-store' }, options),
    retryArtifactDelivery: (id: string, nodeId: string, options: RequestOptions, reportVersionId?: string) =>
      productRequest<{ status: 'accepted'; report_version_id?: string }>(`${BACKEND_URL}${PROJECTS_PATH}/${encodeURIComponent(id)}/observations/retry-artifact-delivery`, {
        method: 'POST', body: JSON.stringify({ project_node_id: nodeId, report_version_id: reportVersionId }),
      }, options),
    observationReport: (id: string, query: ObservationReportQuery, options: RequestOptions, signal?: AbortSignal) => {
      const params = new URLSearchParams({ project_node_id: query.project_node_id });
      if (query.analysis_job_id) params.set('analysis_job_id', query.analysis_job_id);
      if (query.report_version_id) params.set('report_version_id', query.report_version_id);
      return productRequest<ObservationReportDetails>(`${BACKEND_URL}${PROJECTS_PATH}/${encodeURIComponent(id)}/observations/report-details?${params}`, { signal, cache: 'no-store' }, options);
    },
    analysisReportUrl,
    observationAnalysisReport: (projectId: string, nodeId: string, reportId: string, options: RequestOptions, signal?: AbortSignal) =>
      productRequest<{filename: string; text: string}>(analysisReportUrl(projectId, nodeId, reportId), {signal, cache: 'no-store'}, options),
    trainingSeries: (id: string, query: SeriesQuery, options: RequestOptions, signal?: AbortSignal) => {
      const params = new URLSearchParams({ project_node_id: query.project_node_id, run_id: query.run_id, limit: String(query.limit ?? 1000) });
      for (const key of query.keys ?? []) params.append('keys', key);
      if (query.cursor) params.set('cursor', query.cursor);
      return productRequest<SeriesPage>(`${BACKEND_URL}${PROJECTS_PATH}/${encodeURIComponent(id)}/observations/series?${params}`, { signal, cache: 'no-store' }, options);
    },
    eventsUrl: (id: string, afterSeq: number) => `${base}/${encodeURIComponent(id)}/events?afterSeq=${afterSeq}`,
  };
}

export type ProductClient = ReturnType<typeof createProductClient>;

export function createEchoMindChatClient(path: string) {
  const chatUrl = (id: string) => `${BACKEND_URL}${path}/${encodeURIComponent(id)}/chat`;
  return {
    open: (id: string, options: RequestOptions) => productRequest<ConversationSnapshot>(chatUrl(id), {
      method: 'POST',
      body: JSON.stringify({ model: LLM_MODEL || undefined, api_key: LLM_API_KEY || undefined, base_url: LLM_BASE_URL || undefined }),
    }, options),
    snapshot: (id: string, options: RequestOptions, signal?: AbortSignal) => productRequest<ConversationSnapshot | null>(`${chatUrl(id)}/snapshot`, { signal }, options),
    report: (id: string, artifactId: string, options: RequestOptions, signal?: AbortSignal) => productRequest<{text: string}>(
      `${chatUrl(id)}/reports/${encodeURIComponent(artifactId)}`, { signal, cache: 'no-store' }, options,
    ),
    command: (id: string, command: Record<string, unknown>, options: RequestOptions) => productRequest<CommandReceipt>(`${chatUrl(id)}/commands`, { method: 'POST', body: JSON.stringify(command) }, options),
    eventsUrl: (id: string, afterSeq: number) => `${chatUrl(id)}/events?afterSeq=${afterSeq}`,
  };
}

export type EchoMindChatClient = ReturnType<typeof createEchoMindChatClient>;
