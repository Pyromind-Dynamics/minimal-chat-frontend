import type {
  ActionEvent,
  BaseObservation,
  ChatEvent,
  CondensationEvent,
  ContentItem,
  ConversationSnapshot,
  ObservationEvent,
  ProductContent,
  TimelineOperation,
} from './types';

export function snapshotToChatEvents(
  snapshot: ConversationSnapshot,
): ChatEvent[] {
  const events: ChatEvent[] = [];
  for (const item of snapshot.timeline) {
    if (item.kind === 'message') {
      events.push({
        kind: 'MessageEvent',
        id: item.item_id,
        timestamp: '',
        source: item.role === 'assistant' ? 'agent' : 'user',
        run_id: item.run_id,
        llm_message: {
          role: item.role,
          content: item.content.map(toLegacyContent),
        },
      });
      continue;
    }
    if (item.kind === 'operation') {
      events.push(toAction(item));
      events.push(toObservation(item));
      continue;
    }
    if (item.kind === 'workflow') {
      events.push({
        kind: 'ConversationStateUpdateEvent',
        id: item.item_id,
        timestamp: '',
        source: 'environment',
        key: 'pyromind_workflow',
        value: {
          kind: 'WorkflowFileObservation',
          workflow: item.workflow.dsl,
          xyflow: item.workflow.canvas ?? null,
          path: 'public_data/workflow_canvas/workflow.py',
          name: null,
          summary: null,
          exists: true,
        },
      });
      continue;
    }
    if (item.kind === 'compaction') {
      const event: CondensationEvent = {
        kind: 'Condensation',
        id: item.item_id,
        timestamp: '',
        source: 'environment',
        forgotten_event_ids: [],
        summary: item.summary,
        summary_offset: null,
        llm_response_id: item.item_id,
      };
      events.push(event);
      continue;
    }
    if (item.kind === 'notice') {
      events.push({
        kind: 'ServerErrorEvent',
        source: 'environment',
        code: item.code,
        detail: item.message,
      });
    }
  }
  if (snapshot.plan) {
    events.push({
      kind: 'ObservationEvent',
      id: 'product-current-plan',
      timestamp: '',
      source: 'environment',
      tool_name: 'update_plan',
      tool_call_id: 'product-current-plan',
      observation: {
        kind: 'UpdatePlanObservation',
        explanation: snapshot.plan.explanation,
        plan: snapshot.plan.steps,
        is_error: false,
      },
    });
  }
  return events;
}

function toAction(item: TimelineOperation): ActionEvent {
  return {
    kind: 'ActionEvent',
    id: item.item_id,
    timestamp: '',
    source: 'agent',
    tool_name: item.name,
    thought: item.thought.map(toLegacyContent).filter(isTextContent),
    tool_call: {
      name: item.name,
      arguments: normalizeArguments(item.arguments),
    },
  };
}

function toObservation(item: TimelineOperation): ObservationEvent {
  const details = isObject(item.details) ? item.details : { result: item.details };
  const observation: BaseObservation = {
    ...details,
    ...(typeof details.error_code !== 'string' && item.error_code
      ? { error_code: item.error_code }
      : {}),
    operation_status: item.status,
    is_error: item.status === 'failed',
    to_llm_content: item.output.map(toLegacyContent),
  };
  return {
    kind: 'ObservationEvent',
    id: `${item.item_id}:observation`,
    timestamp: '',
    source: 'environment',
    tool_name: item.name,
    tool_call_id: item.item_id,
    action_id: item.item_id,
    observation,
  };
}

function toLegacyContent(content: ProductContent): ContentItem {
  if (content.type === 'image_url') {
    return { type: 'image_url', image_url: { url: content.url } };
  }
  return content;
}

function normalizeArguments(value: unknown): Record<string, unknown> | string {
  if (typeof value === 'string') return value;
  return isObject(value) ? value : { value };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTextContent(
  content: ContentItem,
): content is Extract<ContentItem, { type: 'text' }> {
  return content.type === 'text';
}
