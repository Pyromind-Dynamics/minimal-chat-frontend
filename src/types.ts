// Minimal event types based on agent-server event model

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image_url';
  image_url: { url: string };
}

export type ContentItem = TextContent | ImageContent;

// Message from user or agent
export interface MessageEvent {
  kind: 'MessageEvent';
  id: string;
  timestamp: string;
  source: 'user' | 'agent';
  llm_message: {
    role: string;
    content: ContentItem[];
  };
}

// Tool call (action) from the agent
export interface ActionEvent {
  kind: 'ActionEvent';
  id: string;
  timestamp: string;
  source: 'agent';
  tool_name?: string;
  tool_call: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
}

export interface BaseObservation {
  kind?: string;
  content?: ContentItem[];
  is_error?: boolean;
  name?: string | null;
  result?: Record<string, unknown>;
  to_llm_content?: ContentItem[];
  path?: string | null;
  command?: string;
  old_content?: string | null;
  new_content?: string | null;
  published_workflow?: PublishedWorkflowObservation | null;
}

export interface PublishedWorkflowObservation extends BaseObservation {
  kind: 'PublishedWorkflowObservation';
  workflow: string;
  path: string;
  name: string | null;
  summary: string | null;
  exists: boolean;
}

// Tool execution result
export interface ObservationEvent {
  kind: 'ObservationEvent';
  id: string;
  timestamp: string;
  source: 'environment';
  tool_name?: string;
  tool_call_id?: string;
  action_id?: string;
  observation: BaseObservation | PublishedWorkflowObservation;
}

// Conversation state changes
export interface ConversationStateUpdateEvent {
  kind: 'ConversationStateUpdateEvent';
  id: string;
  timestamp: string;
  source: 'environment';
  field: string;
  value: unknown;
}

// Server error
export interface ServerErrorEvent {
  kind: 'ServerErrorEvent';
  source: 'environment';
  code: string;
  detail: string;
}

export type ChatEvent =
  | MessageEvent
  | ActionEvent
  | ObservationEvent
  | ConversationStateUpdateEvent
  | ServerErrorEvent;

// Conversation info returned from POST /api/conversations
export interface ConversationInfo {
  id: string;
  created_at: string;
  updated_at: string;
  execution_status: string;
}

// Agent execution status
export type ExecutionStatus = 'idle' | 'running' | 'paused' | 'finished' | 'error';

export function isPublishedWorkflowObservation(
  event: ChatEvent | undefined,
): event is ObservationEvent & { observation: PublishedWorkflowObservation } {
  return (
    event?.kind === 'ObservationEvent'
    && event.observation.kind === 'PublishedWorkflowObservation'
  );
}

export function getPublishedWorkflowObservation(
  event: ChatEvent | undefined,
): PublishedWorkflowObservation | null {
  if (isPublishedWorkflowObservation(event)) {
    return event.observation;
  }

  if (event?.kind !== 'ObservationEvent') {
    return null;
  }

  const nested = event.observation.published_workflow;
  if (nested?.kind === 'PublishedWorkflowObservation') {
    return nested;
  }

  return null;
}

export function isPublishWorkflowAction(event: ChatEvent | undefined): boolean {
  return (
    event?.kind === 'ActionEvent'
    && (event.tool_name === 'publish_workflow' || event.tool_call.name === 'publish_workflow')
  );
}
