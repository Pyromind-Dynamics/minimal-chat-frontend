import { productRequest, type RequestOptions } from './api';
import { BACKEND_URL } from './config';
import { PROJECTS_PATH } from './echomindContract';

export interface RuntimeResourceHealth {
  status: 'unknown' | 'healthy' | 'unhealthy';
  checked_at?: string | null;
  message?: string | null;
}

interface RuntimeResource {
  resource_id?: string | null;
  endpoint?: string | null;
  health: RuntimeResourceHealth;
}

export function isPlatformTracerScript(projectId: string, scriptPath?: string | null): boolean {
  const scriptProjectId = scriptPath?.match(/^\/app\/trigger\/echomind-project-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[0-9a-f]{64}\.sh$/)?.[1];
  return scriptProjectId !== undefined && scriptProjectId.replaceAll('-', '') === projectId.replaceAll('-', '').toLowerCase();
}

export interface ProjectRuntimeSlot {
  status: 'uninitialized' | 'initializing' | 'ready' | 'degraded' | 'failed';
  updated_at: string;
  active_release_id?: string | null;
  batch_execution_available?: boolean;
  serving_inference?: (RuntimeResource & {model_uri?: string | null}) | null;
  tracer?: (RuntimeResource & {
    target_inference_resource_id?: string | null;
    custom_runtime_script_path?: string | null;
    buffer_config: {
      batch_size: number;
      trajectory_buffer_size: number;
      time_per_round_seconds: number;
      training_save_path: string;
    };
  }) | null;
  baseline?: {model_uri: string; dataset_uri: string; metrics: Record<string, number>} | null;
  error?: string | null;
}

export interface RuntimeSlotSetup {
  serving_inference_id?: string | null;
  serving_inference_create?: {
    model_path: string;
    model_name: string;
    gpu_card: string;
    gpu_count: number;
    max_model_len: number;
    framework: string;
  } | null;
  tracer: {
    origin_model: string;
    training_model: string;
    training_batch_size: number;
    trajectory_buffer_size: number;
    time_per_round_seconds: number;
    training_rounds: number;
    training_save_path: string;
    execution_mode: 'manual';
  };
  attach_existing_tracer_id?: string;
}

export interface RuntimeResourceProposal {
  project_id: string;
  release_id: string;
  setup: RuntimeSlotSetup;
  digest: string;
}

export interface CollectionSampleSource {
  train_uri: string;
  val_uri: string;
  image_root: string;
}

export interface CollectionSimulation {
  simulation_id: string;
  request_id?: string;
  manual_start?: boolean;
  source?: CollectionSampleSource;
  created_at?: string;
  status: 'pending' | 'feeding' | 'waiting_batch' | 'graph_started' | 'succeeded' | 'paused' | 'failed' | 'canceled';
  requested_samples: number;
  completed_samples: number;
  failed_samples: number;
  requested_rounds: number;
  completed_rounds: number;
  auto_start_graph_run: boolean;
  batch_ids: string[];
  graph_run_ids: string[];
  error?: string | null;
}

export function demoCollectionSelection(simulation?: CollectionSimulation | null) {
  const match = /^demo:[0-9a-f-]{36}:(\d+)$/i.exec(simulation?.request_id ?? '');
  const firstGroup = match ? Number(match[1]) + 1 : undefined;
  if (!firstGroup || !Number.isSafeInteger(firstGroup) || !simulation?.source?.image_root) return undefined;
  return {firstGroup, directory: simulation.source.image_root};
}

const READ_TIMEOUT_MS = 20_000;

function resourcesUrl(projectId: string, suffix: string): string {
  return `${BACKEND_URL}${PROJECTS_PATH}/${encodeURIComponent(projectId)}/${suffix}`;
}

async function readResource<T>(url: string, options: RequestOptions): Promise<T> {
  try {
    return await productRequest<T>(url, {signal: AbortSignal.timeout(READ_TIMEOUT_MS)}, options);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error('读取超时，请重新读取。');
    }
    throw error;
  }
}

export async function getRuntimeSlot(projectId: string, options: RequestOptions): Promise<ProjectRuntimeSlot | null> {
  try {
    return await readResource<ProjectRuntimeSlot>(resourcesUrl(projectId, 'runtime-slot'), options);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Request failed: 404 RuntimeSlot not found:')) return null;
    throw error;
  }
}

export function ensureRuntimeSlot(projectId: string, setup: RuntimeSlotSetup, options: RequestOptions) {
  return productRequest<ProjectRuntimeSlot>(resourcesUrl(projectId, 'runtime-slot/ensure'), {
    method: 'POST', body: JSON.stringify(setup),
  }, options);
}

export function getRuntimeResourceProposal(projectId: string, options: RequestOptions) {
  return readResource<RuntimeResourceProposal | null>(resourcesUrl(projectId, 'runtime-slot/proposal'), options);
}

export function applyRuntimeResourceProposal(projectId: string, digest: string, options: RequestOptions) {
  return productRequest<{status: 'accepted'}>(resourcesUrl(projectId, 'runtime-slot/proposal/apply'), {
    method: 'POST', body: JSON.stringify({expected_digest: digest}),
  }, options);
}

export function checkRuntimeSlotHealth(projectId: string, options: RequestOptions) {
  return productRequest<ProjectRuntimeSlot>(resourcesUrl(projectId, 'runtime-slot/health'), {method: 'POST'}, options);
}

export function setTracerAdminKey(projectId: string, adminKey: string, options: RequestOptions) {
  return productRequest<ProjectRuntimeSlot>(resourcesUrl(projectId, 'runtime-slot/tracer-admin'), {
    method: 'POST', body: JSON.stringify({admin_key: adminKey}),
  }, options);
}

export function listCollectionSimulations(projectId: string, options: RequestOptions) {
  return readResource<CollectionSimulation[]>(resourcesUrl(projectId, 'collection-simulations'), options);
}

export function getImageCollectionConfig(projectId: string, options: RequestOptions) {
  return readResource<{image_directory: string} | null>(resourcesUrl(projectId, 'demo-collection/config'), options);
}

export function getCollectionSimulation(projectId: string, simulationId: string, options: RequestOptions) {
  return readResource<CollectionSimulation>(resourcesUrl(projectId, `collection-simulations/${encodeURIComponent(simulationId)}`), options);
}

export function resumeCollectionSimulation(projectId: string, simulationId: string, options: RequestOptions) {
  return productRequest<CollectionSimulation>(resourcesUrl(projectId, `collection-simulations/${encodeURIComponent(simulationId)}/resume`), {method: 'POST'}, options);
}

export function startDemoCollection(
  projectId: string, request: {request_id: string; image_directory: string; offset: number; limit: number}, options: RequestOptions,
) {
  return productRequest<CollectionSimulation>(resourcesUrl(projectId, 'demo-collection'), {
    method: 'POST', body: JSON.stringify(request),
  }, options);
}

export function startCollectionSimulation(projectId: string, requestId: string, source: CollectionSampleSource, limit: number, runBatch: boolean, options: RequestOptions) {
  return productRequest<CollectionSimulation>(resourcesUrl(projectId, 'collection-simulations'), {
    method: 'POST',
    body: JSON.stringify({request_id: requestId, source, limit, rounds: 1, splits: runBatch ? ['train', 'val'] : ['train'], auto_start_graph_run: runBatch}),
  }, options);
}

export function collectionSimulationActive(simulation: CollectionSimulation): boolean {
  if (simulation.status === 'waiting_batch' && !simulation.auto_start_graph_run) {
    return simulation.completed_rounds < simulation.requested_rounds;
  }
  return ['pending', 'feeding', 'waiting_batch', 'graph_started'].includes(simulation.status);
}

export function collectionSimulationStatus(simulation: CollectionSimulation): string {
  if (simulation.status === 'pending' && simulation.manual_start) return '等待手动启动';
  if (simulation.status === 'waiting_batch' && !collectionSimulationActive(simulation)) return '批次已封存';
  return {
    pending: '等待采样', feeding: '正在采样', waiting_batch: '等待批次', graph_started: '已启动执行流程',
    succeeded: '已完成', paused: '已暂停', failed: '失败', canceled: '已取消',
  }[simulation.status];
}
