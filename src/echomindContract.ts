import type { ConversationInfo } from './types';

export const ECHOMIND_CONVERSATIONS_PATH =
  '/api/echomind/conversations';
export const PROJECTS_PATH = '/api/echomind/projects';

export interface EchoMindConversationInfo {
  conversationId: string;
  agentProfile: 'echomind';
  conversation: ConversationInfo;
}

export interface EchoMindConversationSummary {
  conversationId: string;
  agentProfile: 'echomind';
  title: string | null;
  executionStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface EchoMindConversationBodyInput {
  llm: Record<string, unknown>;
  initialMessage?: string;
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

export interface ProjectNode {
  id: string;
  type: ProjectNodeType;
  title: string;
  status: ProjectNodeStatus;
  executor: string;
  config: Record<string, unknown>;
}

export interface ProjectEdge {
  source: string;
  target: string;
}

export interface ProjectRequest {
  schema_version: 1;
  name: string;
  description: string;
  skill: string;
  requirements: ProjectRequirement[];
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
  created_at: string;
}

export interface PersistedProjectGraph {
  schema_version: 1;
  graph_id: string;
  project_id: string;
  template: string | null;
  nodes: ProjectNode[];
  edges: ProjectEdge[];
}

export interface ProjectInfo {
  project: ProjectRecord;
  graph: PersistedProjectGraph;
}

export interface ProjectNodeExecutionResult {
  project_id: string;
  node_id: string;
  node_type: ProjectNodeType;
  executor: string;
  status: 'not_implemented';
  message: string;
}

export function echomindConversationPath(conversationId: string): string {
  return `${ECHOMIND_CONVERSATIONS_PATH}/${conversationId}`;
}

export function echomindConversationMessagesPath(
  conversationId: string,
): string {
  return `${echomindConversationPath(conversationId)}/messages`;
}

export function echomindProjectRequestPath(conversationId: string): string {
  return `${ECHOMIND_CONVERSATIONS_PATH}/${conversationId}/project-request`;
}

export function echomindProjectNodeRunPath(
  projectId: string,
  nodeId: string,
): string {
  return `${PROJECTS_PATH}/${projectId}/nodes/${nodeId}/run`;
}

export function buildEchoMindConversationBody(
  input: EchoMindConversationBodyInput,
): Record<string, unknown> {
  return {
    llm: input.llm,
    message: input.initialMessage || undefined,
  };
}

export function buildCreateProjectBody(
  conversationId: string,
): Record<string, unknown> {
  return {
    conversation_id: conversationId,
    confirmed: true,
  };
}
