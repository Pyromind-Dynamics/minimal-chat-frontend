export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ImageContentBlock {
  type: 'image';
  mime_type: string;
  data: string;
}

export interface ResourceContentBlock {
  type: 'resource';
  uri: string;
  mime_type?: string | null;
  text?: string | null;
}

export type ContentBlock =
  | TextContentBlock
  | ImageContentBlock
  | ResourceContentBlock;

export interface HarnessCapabilities {
  resume: boolean;
  steer: boolean;
  cancel: boolean;
  permission_reply: boolean;
  partial_message: boolean;
  custom_tools: boolean;
  fork: boolean;
  native_workspace_tools: string[];
}

export type ConversationStatus =
  | 'idle'
  | 'running'
  | 'waiting_permission'
  | 'failed'
  | 'closed';

export interface SnapshotMessage {
  message_id: string;
  started_seq: number;
  role: 'user' | 'assistant' | 'system';
  content: ContentBlock[];
  status: 'streaming' | 'completed' | 'failed';
  run_id?: string | null;
}

export interface SnapshotOperation {
  operation_id: string;
  started_seq: number;
  name: string;
  status: 'running' | 'completed' | 'failed';
  arguments: Record<string, unknown>;
  output: ContentBlock[];
  details?: Record<string, unknown> | null;
  error_code?: string | null;
  run_id?: string | null;
}

export interface SnapshotPermission {
  permission_id: string;
  operation_id?: string | null;
  description: string;
  choices: string[];
}

export interface SnapshotUsage {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_usd?: number | null;
}

export interface WorkflowState {
  resource_id: string;
  version: string;
  dsl: string;
  canvas?: Record<string, unknown> | null;
}

export interface ConversationSnapshot {
  schema_version: number;
  conversation_id: string;
  through_seq: number;
  status: ConversationStatus;
  messages: SnapshotMessage[];
  operations: SnapshotOperation[];
  pending_permissions: SnapshotPermission[];
  workflow?: WorkflowState | null;
  usage: SnapshotUsage;
  capabilities: HarnessCapabilities;
}

export type ProductEventType =
  | 'conversation.created'
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'message.started'
  | 'message.delta'
  | 'message.completed'
  | 'operation.started'
  | 'operation.progress'
  | 'operation.completed'
  | 'operation.failed'
  | 'permission.requested'
  | 'permission.resolved'
  | 'usage.updated'
  | 'workflow.updated';

export interface ProductEvent {
  schema_version: number;
  event_id: string;
  conversation_id: string;
  seq: number;
  occurred_at: string;
  type: ProductEventType;
  run_id?: string | null;
  payload: Record<string, unknown>;
}

export interface CommandReceipt {
  command_id: string;
  status: 'accepted' | 'completed' | 'failed';
  response: Record<string, unknown>;
  recorded_at: string;
}

export type GuidanceStatus = 'waiting' | 'context' | 'processing' | 'failed';
