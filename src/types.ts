// Minimal event types based on agent-server event model

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  image_urls: string[];
}

export interface OpenAIImageContent {
  type: 'image_url';
  image_url: { url: string };
}

export type ContentItem = TextContent | ImageContent | OpenAIImageContent;

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
  thought?: TextContent[];
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
}

export type PlanStatus = 'pending' | 'in_progress' | 'completed';

export interface PlanStep {
  step: string;
  status: PlanStatus;
}

export interface UpdatePlanObservation extends BaseObservation {
  explanation?: string | null;
  plan: PlanStep[];
}

export interface WorkflowFileObservation extends BaseObservation {
  kind: 'WorkflowFileObservation';
  workflow: string;
  xyflow?: Record<string, unknown> | null;
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
  observation: BaseObservation | WorkflowFileObservation | UpdatePlanObservation;
}

// Conversation state changes
// The agent-server only ever serializes this as `key` (see
// ConversationStateUpdateEvent in openhands-sdk). `field` is kept optional
// for backward compatibility with any older payloads.
export interface ConversationStateUpdateEvent {
  kind: 'ConversationStateUpdateEvent';
  id: string;
  timestamp: string;
  source: 'environment';
  key?: string;
  field?: string;
  value: unknown;
}

export type ContextCondensationStatus =
  | 'started'
  | 'completed'
  | 'skipped'
  | 'failed';

export interface ContextCondensationState {
  status: ContextCondensationStatus;
  requirement?: 'soft' | 'hard';
  condensation_id?: string;
}

export interface CondensationEvent {
  kind: 'Condensation';
  id: string;
  timestamp: string;
  source: 'environment';
  forgotten_event_ids: string[];
  summary?: string | null;
  summary_offset?: number | null;
  llm_response_id: string;
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
  | CondensationEvent
  | ConversationStateUpdateEvent
  | ServerErrorEvent;

// Conversation info returned from POST /api/conversations
export interface ConversationInfo {
  id: string;
  created_at: string;
  updated_at: string;
  execution_status: string;
  title?: string | null;
  user_id?: string | null;
}

export interface ConversationPage {
  items: ConversationInfo[];
  next_page_id: string | null;
}

export interface EventPage {
  items: ChatEvent[];
  next_page_id: string | null;
}

export interface PyromindForkAtEventResult {
  conversationId: string;
  sourceConversationId: string;
  forkedAtEventId: string;
  workflowVersionId: string;
  conversation: ConversationInfo;
}

// Agent execution status
export type ExecutionStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'waiting_for_confirmation'
  | 'finished'
  | 'error'
  | 'stuck'
  | 'deleting';

export const CONTEXT_CONDENSATION_STATE_KEY = 'context_condensation';

export function getContextCondensationState(
  event: ChatEvent,
): ContextCondensationState | null {
  if (
    event.kind !== 'ConversationStateUpdateEvent'
    || (event.key ?? event.field) !== CONTEXT_CONDENSATION_STATE_KEY
    || typeof event.value !== 'object'
    || event.value === null
  ) {
    return null;
  }

  const status = (event.value as { status?: unknown }).status;
  if (
    status !== 'started'
    && status !== 'completed'
    && status !== 'skipped'
    && status !== 'failed'
  ) {
    return null;
  }
  return event.value as ContextCondensationState;
}

// Key used by the agent-server when pushing workflow.py updates via
// ConversationStateUpdateEvent (see PYROMIND_WORKFLOW_EVENT_KEY in
// openhands-agent-server/openhands/agent_server/pyromind_constants.py).
// This push is independent of any specific tool call - the server emits it
// whenever workflow.py changes during a run.
const WORKFLOW_EVENT_KEY = 'pyromind_workflow';

function isWorkflowFileObservationValue(
  value: unknown,
): value is WorkflowFileObservation {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { kind?: string }).kind === 'WorkflowFileObservation'
  );
}

export function isWorkflowFileObservationEvent(
  event: ChatEvent | undefined,
): event is ObservationEvent & { observation: WorkflowFileObservation } {
  return (
    event?.kind === 'ObservationEvent'
    && event.observation.kind === 'WorkflowFileObservation'
  );
}

export function getWorkflowFileObservation(
  event: ChatEvent | undefined,
): WorkflowFileObservation | null {
  if (isWorkflowFileObservationEvent(event)) {
    return event.observation;
  }

  if (event?.kind === 'ConversationStateUpdateEvent') {
    const key = event.key ?? event.field;
    if (key === WORKFLOW_EVENT_KEY && isWorkflowFileObservationValue(event.value)) {
      return event.value;
    }
  }

  return null;
}

export function getLatestWorkflowDsl(events: ChatEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const observation = getWorkflowFileObservation(events[index]);
    if (observation) {
      return observation.exists ? observation.workflow : '';
    }
  }
  return null;
}

export function getLatestWorkflowXyflowJson(events: ChatEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const observation = getWorkflowFileObservation(events[index]);
    if (!observation) {
      continue;
    }
    if (!observation.exists) {
      return '';
    }
    if (observation.xyflow) {
      return JSON.stringify(observation.xyflow, null, 2);
    }
    return null;
  }
  return null;
}

export function getLatestPlan(events: ChatEvent[]): UpdatePlanObservation | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (
      event.kind === 'ObservationEvent'
      && event.tool_name === 'update_plan'
      && !event.observation.is_error
      && Array.isArray((event.observation as UpdatePlanObservation).plan)
    ) {
      return event.observation as UpdatePlanObservation;
    }
  }
  return null;
}
