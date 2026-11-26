import { productBlobRequest, productRequest, type RequestOptions } from './api';
import { BACKEND_URL } from './config';

export interface EvaluationRubric {
  name: string;
  criterion: string;
  weight: number;
  required: boolean;
}

export interface ModelEvaluationRecord {
  candidate_id: string;
  project_id: string;
  run_id: string;
  release_id: string;
  round_no: number;
  execution_mode: 'debug' | 'published';
  source_batch_id: string | null;
  model_uri: string;
  deployment_model_uri: string | null;
  training_base_uri: string | null;
  report_uri: string;
  report_html_uri: string | null;
  evaluation_dataset_uri: string | null;
  created_at: string;
  report_status: 'pending' | 'ready' | 'invalid' | 'unavailable';
  evaluation_status: string | null;
  metrics: Record<string, number>;
  dataset_sha256: string | null;
  evaluation_config_sha256: string | null;
  comparison_group: string | null;
  rubrics: EvaluationRubric[];
  pass_threshold: number | null;
  issues: string[];
}

export interface ModelReportCatalog {
  project_id: string;
  candidates: ModelEvaluationRecord[];
}

export interface EvaluationCase {
  id: string;
  status: string;
  input: unknown;
  reference: unknown;
  prediction: unknown;
  overall_score: number | null;
  error: string | null;
  media: {media_id?: string; caption?: string}[];
  rubric_items: {name: string; criterion: string; passed: boolean; score: number; failure_reason?: string}[];
}

export interface EvaluationCasePage {
  items: EvaluationCase[];
  next_cursor: string | null;
  total: number;
  filtered_total: number;
}

export interface StorageBinding {
  project_id: string;
  cluster: string;
  config: {sandbox_id: string; mount_root: string};
  status: 'ready' | 'blocked';
  last_error: string | null;
  last_checked_at: string | null;
}

export interface BatchScheduleConfig {
  enabled: boolean;
  poll_interval_seconds: number;
  source_manifest_uri: string | null;
  validation_dataset_uri: string | null;
}

export interface BatchScheduleState {
  project_id: string;
  config: BatchScheduleConfig;
  status: 'disabled' | 'idle' | 'running' | 'blocked';
  last_checked_at: string | null;
  last_error: string | null;
  receipts: { batch_id: string; run_id: string | null; status: string }[];
}

export type DeploymentStatus = 'submitting' | 'submission_unknown' | 'waiting_inference'
  | 'switching' | 'verifying' | 'rolling_back' | 'rollback_verifying' | 'succeeded' | 'failed';
export interface DeploymentTarget { resource_id: string; model_uri: string; endpoint: string | null }
export interface DeploymentRecord {
  deployment_id: string;
  project_id: string;
  candidate_id: string | null;
  model_uri: string;
  previous: DeploymentTarget;
  target: DeploymentTarget | null;
  status: DeploymentStatus;
  error: string | null;
  cleanup_status: 'not_required' | 'pending' | 'released';
  cleanup_error: string | null;
  created_at: string;
  updated_at: string;
}

function request<T>(projectId: string, suffix: string, options: RequestOptions, body?: object, method?: string) {
  return productRequest<T>(`${BACKEND_URL}/api/echomind/projects/${encodeURIComponent(projectId)}/${suffix}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(body ? 90_000 : 20_000),
  }, options);
}

export const modelReports = (id: string, options: RequestOptions) => request<ModelReportCatalog>(id, 'model-reports', options);
export const refreshModelReport = (id: string, candidate: string, options: RequestOptions) =>
  request<ModelEvaluationRecord>(id, `model-reports/${encodeURIComponent(candidate)}/refresh`, options, {});
export const modelReportDocument = (id: string, candidate: string, options: RequestOptions) =>
  request<{html: string}>(id, `model-reports/${encodeURIComponent(candidate)}/document`, options);
export const modelReportCases = (id: string, candidate: string, cursor: string | null, query: string, options: RequestOptions) =>
  request<EvaluationCasePage>(id, `model-reports/${encodeURIComponent(candidate)}/cases?${new URLSearchParams({limit: '20', ...(cursor ? {cursor} : {}), query})}`, options);
export const modelReportMedia = (id: string, candidate: string, mediaId: string, options: RequestOptions) =>
  productBlobRequest(`${BACKEND_URL}/api/echomind/projects/${encodeURIComponent(id)}/model-reports/${encodeURIComponent(candidate)}/media/${encodeURIComponent(mediaId)}`, options);
export const storageBinding = (id: string, options: RequestOptions) => request<StorageBinding | null>(id, 'storage-binding', options);
export const saveStorageBinding = (id: string, sandboxId: string, options: RequestOptions) =>
  request<StorageBinding>(id, 'storage-binding', options, {sandbox_id: sandboxId, mount_root: '/workspace'}, 'PUT');
export const refreshStorageBinding = (id: string, options: RequestOptions) =>
  request<StorageBinding>(id, 'storage-binding/refresh', options, {});
export const batchSchedule = (id: string, options: RequestOptions) => request<BatchScheduleState>(id, 'batch-schedule', options);
export const saveBatchSchedule = (id: string, config: BatchScheduleConfig, options: RequestOptions) =>
  request<BatchScheduleState>(id, 'batch-schedule', options, config, 'PUT');
export const deploymentHistory = (id: string, options: RequestOptions) => request<DeploymentRecord[]>(id, 'deployments', options);
export const startDeployment = (id: string, target: {candidate_id: string} | {rollback_deployment_id: string}, requestId: string, options: RequestOptions) =>
  request<DeploymentRecord>(id, 'deployments', options, {request_id: requestId, ...target});
export const advanceDeployment = (id: string, deploymentId: string, options: RequestOptions) =>
  request<DeploymentRecord>(id, `deployments/${encodeURIComponent(deploymentId)}/advance`, options, {});

export const deploymentActive = (record: DeploymentRecord) => !['succeeded', 'failed'].includes(record.status);
export const deploymentStatusLabel: Record<DeploymentStatus, string> = {
  submitting: '提交推理资源', submission_unknown: '核对提交结果', waiting_inference: '等待候选推理就绪',
  switching: '切换 Tracer 上游', verifying: '验证实际流量', rolling_back: '恢复原模型',
  rollback_verifying: '验证回滚结果', succeeded: '部署完成', failed: '部署失败',
};

export function comparable(left: ModelEvaluationRecord, right: ModelEvaluationRecord): boolean {
  return hasComparisonEvidence(left) && hasComparisonEvidence(right)
    && left.project_id === right.project_id && left.comparison_group === right.comparison_group;
}

export function rankCandidates(candidates: ModelEvaluationRecord[], group: string, metric: string, ascending = false): ModelEvaluationRecord[] {
  if (!group) return [];
  return candidates.filter(item => hasComparisonEvidence(item) && item.comparison_group === group && Number.isFinite(item.metrics[metric]))
    .sort((a, b) => (ascending ? 1 : -1) * (a.metrics[metric] - b.metrics[metric]));
}

function hasComparisonEvidence(candidate: ModelEvaluationRecord): boolean {
  return candidate.report_status === 'ready' && candidate.evaluation_status === 'validated'
    && !!candidate.comparison_group && !!candidate.dataset_sha256 && !!candidate.evaluation_config_sha256;
}

export function deployable(candidate: ModelEvaluationRecord): boolean {
  return candidate.report_status === 'ready' && candidate.evaluation_status === 'validated'
    && candidate.execution_mode === 'published' && !!candidate.deployment_model_uri?.trim();
}
