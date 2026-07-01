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
  tool_call: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

// Tool execution result
export interface ObservationEvent {
  kind: 'ObservationEvent';
  id: string;
  timestamp: string;
  source: 'environment';
  observation: {
    name: string;
    result: Record<string, unknown>;
    to_llm_content?: ContentItem[];
  };
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
