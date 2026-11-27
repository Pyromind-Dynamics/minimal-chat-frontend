export type ProjectLifecycle = 'development' | 'frozen';

export interface ProjectRequirement {
  key: string;
  label: string;
  value: string;
  status: 'missing' | 'resolved' | 'conflict';
}

export type ProjectNodeInputBindingKind =
  | 'run_input'
  | 'runtime_slot'
  | 'node_output'
  | 'literal';

export interface ProjectNodeInputBinding {
  kind: ProjectNodeInputBindingKind;
  name?: string | null;
  node_id?: string | null;
  port?: string | null;
  value?: unknown;
}

export interface ProjectNodeInput {
  artifact_type: string;
  schema_ref: string;
  required: boolean;
  binding: ProjectNodeInputBinding;
}

export interface ProjectNodeOutput {
  artifact_type: string;
  schema_ref: string;
  required: boolean;
}

export interface ProjectNode {
  id: string;
  type: string;
  title: string;
  status: string;
  task_type?: string | null;
  execution_role?: string | null;
  launch_mode: string;
  executor: string;
  implementation_ref?: string | null;
  implementation_digest?: string | null;
  inputs: Record<string, ProjectNodeInput>;
  outputs: Record<string, ProjectNodeOutput>;
  config: Record<string, unknown>;
  policies: Record<string, unknown>;
}

export interface ProjectEdge {
  source: string;
  target: string;
}

export interface ProjectRecord {
  schema_version: number;
  project_id: string;
  name: string;
  description: string;
  skill: string;
  requirements: ProjectRequirement[];
  owner_user_id: string | null;
  conversation_id: string;
  cluster: string;
  lifecycle: ProjectLifecycle;
  active_release_id?: string | null;
  source_project_id?: string | null;
  runtime_contract_sha256?: string | null;
  validation_project_id?: string | null;
  frozen_at?: string | null;
  created_at: string;
}

export interface ProjectGraph {
  schema_version: number;
  graph_id: string;
  project_id: string;
  template?: string | null;
  lifecycle: ProjectLifecycle;
  nodes: ProjectNode[];
  edges: ProjectEdge[];
}

export interface FullProjectInfo {
  project: ProjectRecord;
  graph: ProjectGraph;
}

export interface PublicationIssue {
  code: string;
  message: string;
  node_id?: string | null;
}

export interface RuntimeContractAssumption {
  code: string;
  message: string;
  node_id?: string | null;
}

export interface DebugExecutionCandidate {
  source_project_id: string;
  source_project_name: string;
  run_id: string;
  release_id: string;
  release_digest: string;
  finished_at: string | null;
  reused_node_ids?: string[];
}

export interface DebugExecutionAdoptionPreview {
  source: DebugExecutionCandidate;
  changes: Array<{node_id: string; changed_fields: string[]}>;
  content_sha256: string;
}

export type ConsolidationStage = 'dataset' | 'train' | 'eval';
export type ConsolidationTaskIds = Partial<Record<ConsolidationStage, string>>;

export interface DatasetReplayEvidence {
  batch_label_source?: 'dataset' | 'collection' | null;
  fixed_validation_path?: string | null;
  source_kinds: string[];
  val_rows?: number[];
}

export interface ConsolidationReview {
  context: {
    evidence: Record<ConsolidationStage, { task_id: string; definition_sha256: string }>;
    evidence_sha256: string;
    source_batch?: string;
    image_directory?: string;
    base_model: string;
    validation_dataset: string;
  };
  proposal_path: string;
  proposal_sha256: string | null;
  draft: RuntimeContractUpgradeDraft | null;
  issue: string | null;
  blockers?: Array<{stage: ConsolidationStage; code: string; message: string}>;
  stages?: Array<{
    stage: ConsolidationStage;
    status: 'ready' | 'blocked';
    verification?: 'static' | 'replayed' | null;
    verification_task_ids?: string[];
  }>;
  assets?: Record<string, unknown> & { dataset_replay?: DatasetReplayEvidence };
}

export interface ConsolidationGeneration {
  review: ConsolidationReview;
  repair: {
    stage: ConsolidationStage;
    command_id: string;
    status: 'working' | 'needs_input' | 'blocked';
    message: string;
  } | null;
}

export interface ConsolidationJob {
  job_id: string;
  scope: 'stage' | 'graph';
  stage_id: string | null;
  objective: string;
  revision: number;
  plan_sequence: number;
  status: 'queued' | 'running' | 'waiting_external' | 'waiting_input' | 'blocked' | 'paused' | 'budget_limited' | 'ready';
  task_ids: ConsolidationTaskIds;
  review?: ConsolidationReview | null;
  blockers: Array<{stage: ConsolidationStage; code: string; message: string}>;
  repair_command_id: string | null;
  waiting_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConsolidationState {
  revision: number;
  conversation_id: string;
  project_id: string | null;
  plan_sequence: number;
  project_goal: string;
  stages: Record<string, {
    stage_id: string;
    current_revision: number;
    status: 'pending' | 'revising' | 'verified' | 'needs_verification';
    selected_delivery_id: string | null;
  }>;
  jobs: Record<string, ConsolidationJob>;
}

export function latestGraphConsolidationJob(state: ConsolidationState): ConsolidationJob | null {
  return Object.values(state.jobs)
    .filter(job => job.scope === 'graph' && job.plan_sequence === state.plan_sequence)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null;
}

export function consolidationArchiveAssets(assets: ConsolidationReview['assets']): Array<{
  stage: 'dataset' | 'eval';
  role: string;
  path: string;
}> {
  const references: Array<{stage: 'dataset' | 'eval'; role: string; path: string}> = [];
  const add = (stage: 'dataset' | 'eval', role: unknown, path: unknown) => {
    if (typeof role !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(role) || typeof path !== 'string') return;
    const workspacePath = path.startsWith('/workspace/') && path === path.trim()
      && !/[\\:?#\p{Cc}]/u.test(path)
      && path.slice('/workspace/'.length).split('/').every(part => part && part !== '.' && part !== '..');
    if (workspacePath || /^version:\/\/r[0-9]+$/.test(path)) {
      references.push({stage, role, path});
    }
  };
  if (Array.isArray(assets?.dataset)) {
    for (const asset of assets.dataset) {
      if (isRecord(asset)) add('dataset', asset.role, asset.path);
    }
  }
  if (isRecord(assets?.eval)) {
    for (const [role, asset] of Object.entries(assets.eval)) {
      if (isRecord(asset)) add('eval', role, asset.path);
    }
  }
  return references;
}

export interface RuntimeContractUpgradeDraft {
  schema_version: number;
  source_project_id: string;
  source_graph_id: string;
  source_graph_digest: string;
  nodes: ProjectNode[];
  edges: ProjectEdge[];
  assumptions: RuntimeContractAssumption[];
  issues: PublicationIssue[];
  content_sha256: string;
  validation_project_id?: string | null;
  validation_candidates?: Array<{project_id: string; name: string}>;
  adopted_debug_run?: DebugExecutionCandidate | null;
  resource_release_id?: string | null;
}

export interface ReviewedRuntimeContract {
  expected_contract_sha256: string;
  validation_project_id?: string;
}

export interface RuntimeContractApplication {
  schema_version: number;
  source_project_id: string;
  draft_sha256: string;
  project: FullProjectInfo;
}

export interface RuntimeImplementationAdoption {
  schema_version: number;
  source_project_id: string;
  validation_project_id: string;
  project: FullProjectInfo;
}

export interface PublicationPreflight {
  schema_version: number;
  project_id: string;
  source_graph_id: string;
  source_graph_digest: string;
  publication_mode: 'debug' | 'production';
  ready: boolean;
  issues: PublicationIssue[];
}

export interface RuntimeRequirements {
  tracer: 'attach_existing' | 'create_if_missing';
  serving_inference: 'attach_existing';
  candidate_inference: 'evaluator_managed';
  max_active_graph_runs: number;
}

export interface PromotionPolicy {
  metric: string;
  direction: 'maximize' | 'minimize';
  minimum_gain: number;
  require_candidate_healthy: boolean;
}

export interface PublishedGraph {
  schema_version: number;
  release_id: string;
  project_id: string;
  source_graph_id: string;
  source_graph_digest: string;
  execution_profile: string;
  publication_mode: 'debug' | 'production';
  runtime_requirements: RuntimeRequirements;
  promotion_policy: PromotionPolicy;
  nodes: ProjectNode[];
  edges: ProjectEdge[];
  content_sha256: string;
  published_at: string;
  published_by: string;
  adopted_debug_run?: DebugExecutionCandidate | null;
}

export interface PublishedGraphDraft extends Omit<PublishedGraph, 'release_id' | 'published_at' | 'published_by'> {
  candidate_release_id: string;
}

export type GraphRunStatus =
  | 'pending'
  | 'running'
  | 'waiting_external'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export type GraphRunOutcome =
  | 'candidate_recorded'
  | 'promoted'
  | 'baseline_retained'
  | 'canceled'
  | 'failed';

export interface RuntimeFailure {
  category: 'validation' | 'external' | 'infrastructure' | 'policy' | 'canceled';
  message: string;
  details: Record<string, unknown>;
  failed_at: string;
}

export interface ArtifactRef {
  artifact_type: string;
  uri: string;
  content_sha256?: string | null;
  metadata: Record<string, unknown>;
}

export interface TaskRun {
  schema_version: number;
  task_run_id: string;
  stage_run_id: string;
  provider: string;
  provider_run_id?: string | null;
  idempotency_key: string;
  status: 'submitting' | 'submitted' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'unknown';
  requires_request_credentials?: boolean;
  provider_reported_status?: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | null;
  request_digest: string;
  created_at: string;
  submitted_at?: string | null;
  last_polled_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
}

export interface StageRun {
  schema_version: number;
  run_id: string;
  graph_run_id?: string | null;
  project_id: string;
  node_id: string;
  node_type: string;
  mode: string;
  attempt: number;
  executor: string;
  executor_kind?: string | null;
  task_type?: string | null;
  implementation_ref?: string | null;
  implementation_digest?: string | null;
  status:
    | 'pending'
    | 'clarifying'
    | 'running'
    | 'waiting_user'
    | 'waiting_external'
    | 'paused'
    | 'succeeded'
    | 'failed'
    | 'canceled';
  message: string;
  input_refs: string[];
  output_refs: ArtifactRef[];
  task_runs: TaskRun[];
  artifacts: Array<{
    artifact_id: string;
    project_id: string;
    node_id: string;
    run_id: string;
    kind: string;
    format: string;
    uri: string;
    content_sha256: string;
    size_bytes: number;
    created_at: string;
  }>;
  error?: string | null;
  reused_from_stage_run_id?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface GraphRun {
  schema_version: number;
  run_id: string;
  project_id: string;
  release_id: string;
  release_digest: string;
  round_no: number;
  request_id: string;
  trigger: 'manual' | 'tracer_batch';
  execution_mode?: 'debug' | 'published';
  source_tracer_resource_id?: string | null;
  source_batch_id?: string | null;
  status: GraphRunStatus;
  outcome?: GraphRunOutcome | null;
  inputs: Record<string, unknown>;
  current_stage_ids: string[];
  promotion_result: Record<string, unknown>;
  failure?: RuntimeFailure | null;
  repair_handoffs?: Array<{ stage_run_id: string; delivered_at?: string | null }>;
  repair_of_run_id?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface GraphRunDetail {
  run: GraphRun;
  stage_runs: StageRun[];
  task_runs: TaskRun[];
}

export function pendingArtifactVerificationTask(detail: GraphRunDetail): TaskRun | undefined {
  if (detail.run.status !== 'waiting_external') return;
  for (const stage of detail.stage_runs) {
    if (stage.status !== 'waiting_external' || !detail.run.current_stage_ids.includes(stage.run_id)) continue;
    const legacyStorageWait = stage.message ===
      `${stage.node_id} is waiting for request credentials to poll the platform task: Storage verification requires the project owner's browser session.`;
    const task = stage.task_runs.find(task => task.provider_run_id && !task.finished_at
      && (task.status === 'submitted' || task.status === 'running')
      && (task.provider_reported_status === 'succeeded' || task.requires_request_credentials
        || (task.requires_request_credentials === undefined && legacyStorageWait)));
    if (task) return task;
  }
}

export interface GraphRepairProposal {
  node_id: string;
  reason: string;
  content_sha256: string;
  changed_fields: string[];
}

export interface RunInputDefinition {
  name: string;
  artifactType: string;
  defaultValue: string;
  usedBy: string[];
}

export const ACTIVE_GRAPH_RUN_STATUSES = new Set<GraphRunStatus>([
  'pending',
  'running',
  'waiting_external',
  'paused',
]);

export function selectProductionRun(runs: GraphRun[], releaseId: string): GraphRun | undefined {
  const production = runs.filter(run => run.execution_mode !== 'debug' && run.release_id === releaseId);
  return production.find(run => ACTIVE_GRAPH_RUN_STATUSES.has(run.status)) ?? production[0];
}

export function collectRunInputs(nodes: ProjectNode[]): RunInputDefinition[] {
  const definitions = new Map<string, RunInputDefinition>();
  for (const node of nodes) {
    const resources = Array.isArray(node.config.resources)
      ? node.config.resources.filter(isRecord)
      : [];
    for (const input of Object.values(node.inputs)) {
      const binding = input.binding;
      if ((binding.kind !== 'run_input' && binding.kind !== 'runtime_slot') || !binding.name) {
        continue;
      }
      const existing = definitions.get(binding.name) ?? {
        name: binding.name,
        artifactType: input.artifact_type,
        defaultValue: '',
        usedBy: [],
      };
      const resource = resources.find(item => item.id === binding.name);
      const defaults = node.config.runtime_input_defaults;
      const explicit = isRecord(defaults) ? defaults[binding.name] : undefined;
      if (typeof explicit === 'string') {
        existing.defaultValue = explicit;
      } else if (!existing.defaultValue && typeof resource?.uri === 'string') {
        existing.defaultValue = resource.uri;
      }
      if (!existing.usedBy.includes(node.id)) existing.usedBy.push(node.id);
      definitions.set(binding.name, existing);
    }
  }
  return [...definitions.values()];
}

export function reconcileRunInputs(
  nodes: ProjectNode[],
  current: Record<string, string>,
  replaceWithDefaults = false,
): Record<string, string> {
  return Object.fromEntries(
    collectRunInputs(nodes).map(input => [
      input.name,
      replaceWithDefaults
        ? input.defaultValue
        : current[input.name] ?? input.defaultValue,
    ]),
  );
}

export function graphRunStatusLabel(status: GraphRunStatus): string {
  switch (status) {
    case 'pending': return '待启动';
    case 'running': return '执行中';
    case 'waiting_external': return '等待外部任务';
    case 'paused': return '已暂停';
    case 'succeeded': return '执行成功';
    case 'failed': return '执行失败';
    case 'canceled': return '已取消';
  }
}

export function stageRunStatusLabel(status: StageRun['status']): string {
  switch (status) {
    case 'pending': return '待执行';
    case 'clarifying': return '澄清中';
    case 'running': return '执行中';
    case 'waiting_user': return '等待用户';
    case 'waiting_external': return '等待外部任务';
    case 'paused': return '已暂停';
    case 'succeeded': return '成功';
    case 'failed': return '失败';
    case 'canceled': return '已取消';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
