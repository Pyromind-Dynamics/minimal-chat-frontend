export const ECHOMIND_CONVERSATIONS_PATH =
  '/api/v2/echomind/conversations';
export const PROJECTS_PATH = '/api/echomind/projects';

export interface EchoMindConversationBodyInput {
  llm: Record<string, unknown>;
  initialMessage?: string;
  userInputEnabled?: boolean;
}

export interface ProjectRequirement {
  key: string;
  label: string;
  value: string;
  status: 'confirmed' | 'missing';
}

export type ProjectNodeType =
  | 'dataset'
  | 'inference'
  | 'evaluator'
  | 'train';

export type ProjectNodeStatus =
  | 'idle'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'not_implemented';

export type ProjectLifecycle = 'development' | 'frozen';
export type ProjectNodeLaunchMode = 'agent' | 'executor';

export interface ProjectPortBinding {
  kind: 'run_input' | 'node_output' | 'literal';
  name: string | null;
  node_id: string | null;
  port: string | null;
  value: unknown;
}

export interface ProjectInputPort {
  artifact_type: string;
  schema_ref: string | null;
  required: boolean;
  binding: ProjectPortBinding | null;
}

export interface ProjectOutputPort {
  artifact_type: string;
  schema_ref: string | null;
  required: boolean;
}

export interface ProjectExecutorBinding {
  kind: string;
  implementation_ref: string | null;
  implementation_digest: string | null;
  config: Record<string, unknown>;
  runtime: {
    image: string | null;
    entrypoint: string | null;
  };
}

export interface ProjectNode {
  id: string;
  type: ProjectNodeType;
  title: string;
  task_type: string;
  status: ProjectNodeStatus;
  launch_mode: ProjectNodeLaunchMode;
  execution_role: string;
  inputs: Record<string, ProjectInputPort>;
  outputs: Record<string, ProjectOutputPort>;
  executor: ProjectExecutorBinding;
  config: Record<string, unknown>;
  policies: Record<string, unknown>;
}

export interface ProjectEdge {
  source: string;
  source_port: string | null;
  target: string;
  target_port: string | null;
}

export interface ProjectRecord {
  schema_version: 2;
  project_id: string;
  name: string;
  description: string;
  skill: string;
  requirements: ProjectRequirement[];
  owner_user_id: string | null;
  conversation_id: string;
  cluster: string;
  lifecycle: ProjectLifecycle;
  frozen_at: string | null;
  created_at: string;
}

export interface ProjectSummary {
  project_id: string;
  name: string;
  description: string;
  skill: string;
  owner_user_id: string | null;
  conversation_id: string;
  cluster: string;
  lifecycle: ProjectLifecycle;
  node_count: number;
  created_at: string;
  updated_at: string;
}

export interface PersistedProjectGraph {
  schema_version: 1;
  graph_id: string;
  project_id: string;
  template: string | null;
  lifecycle: ProjectLifecycle;
  nodes: ProjectNode[];
  edges: ProjectEdge[];
}

export interface ProjectInfo {
  project: ProjectRecord;
  graph: PersistedProjectGraph;
}

export interface ProjectGraphView {
  schema_version: 1;
  project_id: string;
  graph_id: string;
  name: string;
  description: string;
  lifecycle: ProjectLifecycle;
  template: string | null;
  requirements: ProjectRequirement[];
  nodes: ProjectNode[];
  edges: ProjectEdge[];
}

export type StageRunStatus =
  | 'clarifying'
  | 'running'
  | 'waiting_user'
  | 'waiting_external'
  | 'succeeded'
  | 'failed';

export interface ProjectArtifact {
  schema_version: 1;
  artifact_id: string;
  project_id: string;
  node_id: string;
  run_id: string;
  kind: string;
  format: 'json';
  schema_ref: string | null;
  metadata: Record<string, unknown>;
  uri: string;
  content_sha256: string;
  size_bytes: number;
  created_at: string;
}

export interface StageTaskRun {
  request_id: string;
  task_run_id: string;
  role_id: string;
  intent: 'execute' | 'prepare';
  status: StageRunStatus;
  message: string;
  external_task_id: string | null;
  output_uri: string | null;
  artifact_ids: string[];
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface StageRun {
  schema_version: 1;
  mode: 'node_validation' | 'agent_development';
  request_id: string | null;
  run_id: string;
  graph_run_id: string | null;
  project_id: string;
  node_id: string;
  node_type: ProjectNodeType;
  task_type: string;
  attempt: number;
  executor_kind: string;
  executor: string;
  implementation_ref: string | null;
  implementation_digest: string | null;
  node_config_digest: string;
  config_digest_version: 1 | 2;
  status: StageRunStatus;
  message: string;
  command_id: string | null;
  external_task_id: string | null;
  task_run_id: string | null;
  task_runs: StageTaskRun[];
  output_uri: string | null;
  input_refs: string[];
  output_refs: string[];
  artifacts: ProjectArtifact[];
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface ProjectArtifactDocument {
  schema_version: 1;
  artifact: ProjectArtifact;
  content: Record<string, unknown>;
}

export interface ProjectNodeStart {
  schema_version: 1;
  project_id: string;
  graph_id: string;
  node_id: string;
  conversation_id: string;
  cluster: string;
  event_id: string;
  run: StageRun;
  status: 'started';
}

export function echomindConversationPath(conversationId: string): string {
  return `${ECHOMIND_CONVERSATIONS_PATH}/${conversationId}`;
}

export function echomindConversationSnapshotPath(
  conversationId: string,
): string {
  return `${echomindConversationPath(conversationId)}/snapshot`;
}

export function echomindConversationCommandsPath(
  conversationId: string,
): string {
  return `${echomindConversationPath(conversationId)}/commands`;
}

export function echomindConversationEventsPath(
  conversationId: string,
): string {
  return `${echomindConversationPath(conversationId)}/events`;
}

export function echomindProjectPath(projectId: string): string {
  return `${PROJECTS_PATH}/${projectId}`;
}

export function echomindProjectGraphPath(projectId: string): string {
  return `${PROJECTS_PATH}/${projectId}/graph`;
}

export function echomindProjectNodeRunPath(
  projectId: string,
  nodeId: string,
): string {
  return `${PROJECTS_PATH}/${projectId}/nodes/${nodeId}/run`;
}

export function echomindProjectNodeStartPath(
  projectId: string,
  nodeId: string,
): string {
  return `${PROJECTS_PATH}/${projectId}/nodes/${nodeId}/start`;
}

export function echomindProjectRunsPath(projectId: string): string {
  return `${PROJECTS_PATH}/${projectId}/runs`;
}

export function echomindProjectArtifactPath(
  projectId: string,
  artifactId: string,
): string {
  return `${PROJECTS_PATH}/${projectId}/artifacts/${artifactId}`;
}

export async function nodeConfigDigest(
  node: ProjectNode,
): Promise<string> {
  const identity = Object.fromEntries(
    Object.entries(node).filter(([key]) => key !== 'status'),
  );
  const payload = JSON.stringify(stableJsonValue(identity));
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload),
  );
  const hash = Array.from(
    new Uint8Array(digest),
    byte => byte.toString(16).padStart(2, '0'),
  ).join('');
  return `sha256:${hash}`;
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, stableJsonValue(item)]),
    );
  }
  return value;
}

export function buildEchoMindConversationBody(
  input: EchoMindConversationBodyInput,
): Record<string, unknown> {
  return {
    llm: input.llm,
    message: input.initialMessage || undefined,
    user_input_enabled: input.userInputEnabled ?? true,
  };
}
