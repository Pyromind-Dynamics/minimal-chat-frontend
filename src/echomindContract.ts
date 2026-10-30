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

export interface ProjectNode {
  id: string;
  type: ProjectNodeType;
  title: string;
  status: ProjectNodeStatus;
  launch_mode: ProjectNodeLaunchMode;
  executor: string;
  config: Record<string, unknown>;
}

export interface ProjectEdge {
  source: string;
  target: string;
}

export interface ProjectRecord {
  schema_version: 1;
  project_id: string;
  name: string;
  description: string;
  skill: string;
  requirements: ProjectRequirement[];
  owner_user_id: string | null;
  echomind_conversation_id: string;
  lifecycle: ProjectLifecycle;
  frozen_at: string | null;
  created_at: string;
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

export type StageRunStatus = 'running' | 'succeeded' | 'failed';

export interface ProjectArtifact {
  schema_version: 1;
  artifact_id: string;
  project_id: string;
  node_id: string;
  run_id: string;
  kind: string;
  format: 'json';
  uri: string;
  content_sha256: string;
  size_bytes: number;
  created_at: string;
}

export interface StageRun {
  schema_version: 1;
  run_id: string;
  project_id: string;
  node_id: string;
  node_type: ProjectNodeType;
  executor: string;
  status: StageRunStatus;
  message: string;
  input_refs: string[];
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
  event_id: string;
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

export function buildEchoMindConversationBody(
  input: EchoMindConversationBodyInput,
): Record<string, unknown> {
  return {
    llm: input.llm,
    message: input.initialMessage || undefined,
    user_input_enabled: input.userInputEnabled ?? true,
  };
}
