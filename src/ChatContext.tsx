import {
  createContext,
  useContext,
} from 'react';
import type {
  ContentBlock,
  ConversationSnapshot,
  ProductEvent,
  SnapshotMessage,
  SnapshotOperation,
  SnapshotPermission,
  SnapshotUsage,
  WorkflowState,
} from './types';

interface ChatState {
  conversationId: string | null;
  snapshot: ConversationSnapshot | null;
  error: string | null;
}

type ChatAction =
  | { type: 'SET_SNAPSHOT'; snapshot: ConversationSnapshot }
  | { type: 'RESET_CONVERSATION' }
  | { type: 'APPLY_EVENT'; event: ProductEvent }
  | { type: 'SET_ERROR'; error: string | null };

export const initialState: ChatState = {
  conversationId: null,
  snapshot: null,
  error: null,
};

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  if (action.type === 'SET_SNAPSHOT') {
    return {
      conversationId: action.snapshot.conversation_id,
      snapshot: action.snapshot,
      error: null,
    };
  }
  if (action.type === 'RESET_CONVERSATION') {
    return initialState;
  }
  if (action.type === 'SET_ERROR') {
    return { ...state, error: action.error };
  }
  if (!state.snapshot || action.event.conversation_id !== state.conversationId) {
    return state;
  }
  if (action.event.seq <= state.snapshot.through_seq) {
    return state;
  }
  if (action.event.seq !== state.snapshot.through_seq + 1) {
    return {
      ...state,
      error: `Event sequence gap: expected ${state.snapshot.through_seq + 1}, received ${action.event.seq}`,
    };
  }
  const snapshot = applyProductEvent(state.snapshot, action.event);
  const error = action.event.type === 'run.failed'
    ? payloadString(action.event.payload, 'message') || 'Agent run failed.'
    : state.error;
  return { ...state, snapshot, error };
}

function applyProductEvent(
  snapshot: ConversationSnapshot,
  event: ProductEvent,
): ConversationSnapshot {
  let updated = snapshot;
  switch (event.type) {
    case 'run.started':
      updated = { ...snapshot, status: 'running' };
      break;
    case 'run.completed':
      updated = { ...snapshot, status: 'idle' };
      break;
    case 'run.failed':
      updated = { ...snapshot, status: 'failed' };
      break;
    case 'message.started':
      updated = startMessage(snapshot, event);
      break;
    case 'message.delta':
      updated = appendMessageDelta(snapshot, event);
      break;
    case 'message.completed':
      updated = completeMessage(snapshot, event);
      break;
    case 'operation.started':
      updated = startOperation(snapshot, event);
      break;
    case 'operation.progress':
      updated = updateOperation(snapshot, event, 'running');
      break;
    case 'operation.completed':
      updated = updateOperation(snapshot, event, 'completed');
      break;
    case 'operation.failed':
      updated = updateOperation(snapshot, event, 'failed');
      break;
    case 'permission.requested':
      updated = {
        ...snapshot,
        status: 'waiting_permission',
        pending_permissions: [
          ...snapshot.pending_permissions,
          event.payload as unknown as SnapshotPermission,
        ],
      };
      break;
    case 'permission.resolved': {
      const permissionId = payloadString(event.payload, 'permission_id');
      const pending = snapshot.pending_permissions.filter(
        (permission) => permission.permission_id !== permissionId,
      );
      updated = {
        ...snapshot,
        status: pending.length > 0 ? 'waiting_permission' : 'running',
        pending_permissions: pending,
      };
      break;
    }
    case 'usage.updated':
      updated = { ...snapshot, usage: event.payload as unknown as SnapshotUsage };
      break;
    case 'workflow.updated':
      updated = { ...snapshot, workflow: event.payload as unknown as WorkflowState };
      break;
    case 'conversation.created':
      break;
  }
  return { ...updated, through_seq: event.seq };
}

function startMessage(
  snapshot: ConversationSnapshot,
  event: ProductEvent,
): ConversationSnapshot {
  const messageId = payloadString(event.payload, 'message_id');
  if (!messageId || snapshot.messages.some((message) => message.message_id === messageId)) {
    return snapshot;
  }
  const role = event.payload.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'system') {
    return snapshot;
  }
  const message: SnapshotMessage = {
    message_id: messageId,
    started_seq: event.seq,
    role,
    content: payloadContent(event.payload),
    status: 'streaming',
    run_id: event.run_id,
  };
  return { ...snapshot, messages: [...snapshot.messages, message] };
}

function appendMessageDelta(
  snapshot: ConversationSnapshot,
  event: ProductEvent,
): ConversationSnapshot {
  const messageId = payloadString(event.payload, 'message_id');
  const text = payloadString(event.payload, 'text', true);
  return replaceMessage(snapshot, messageId, (message) => {
    const content = [...message.content];
    const last = content.at(-1);
    if (last?.type === 'text') {
      content[content.length - 1] = { ...last, text: last.text + text };
    } else {
      content.push({ type: 'text', text });
    }
    return { ...message, content };
  });
}

function completeMessage(
  snapshot: ConversationSnapshot,
  event: ProductEvent,
): ConversationSnapshot {
  const messageId = payloadString(event.payload, 'message_id');
  return replaceMessage(snapshot, messageId, (message) => ({
    ...message,
    status: 'completed',
    content: 'content' in event.payload
      ? payloadContent(event.payload)
      : message.content,
  }));
}

function startOperation(
  snapshot: ConversationSnapshot,
  event: ProductEvent,
): ConversationSnapshot {
  const operationId = payloadString(event.payload, 'operation_id');
  const name = payloadString(event.payload, 'name');
  if (
    !operationId
    || !name
    || snapshot.operations.some((operation) => operation.operation_id === operationId)
  ) {
    return snapshot;
  }
  const operation: SnapshotOperation = {
    operation_id: operationId,
    started_seq: event.seq,
    name,
    status: 'running',
    arguments: payloadObject(event.payload, 'arguments'),
    output: [],
    run_id: event.run_id,
  };
  return { ...snapshot, operations: [...snapshot.operations, operation] };
}

function updateOperation(
  snapshot: ConversationSnapshot,
  event: ProductEvent,
  status: SnapshotOperation['status'],
): ConversationSnapshot {
  const operationId = payloadString(event.payload, 'operation_id');
  return {
    ...snapshot,
    operations: snapshot.operations.map((operation) => {
      if (operation.operation_id !== operationId) return operation;
      return {
        ...operation,
        status,
        output: 'content' in event.payload
          ? payloadContent(event.payload)
          : operation.output,
        details: 'details' in event.payload
          ? payloadNullableObject(event.payload, 'details')
          : operation.details,
        error_code: 'error_code' in event.payload
          ? payloadString(event.payload, 'error_code') || null
          : operation.error_code,
      };
    }),
  };
}

function replaceMessage(
  snapshot: ConversationSnapshot,
  messageId: string,
  update: (message: SnapshotMessage) => SnapshotMessage,
): ConversationSnapshot {
  return {
    ...snapshot,
    messages: snapshot.messages.map((message) =>
      message.message_id === messageId ? update(message) : message
    ),
  };
}

function payloadString(
  payload: Record<string, unknown>,
  key: string,
  allowEmpty = false,
): string {
  const value = payload[key];
  return typeof value === 'string' && (allowEmpty || value.length > 0) ? value : '';
}

function payloadContent(payload: Record<string, unknown>): ContentBlock[] {
  return Array.isArray(payload.content) ? payload.content as ContentBlock[] : [];
}

function payloadObject(
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return payloadNullableObject(payload, key) ?? {};
}

function payloadNullableObject(
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = payload[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

interface ChatContextValue {
  state: ChatState;
  dispatch: React.Dispatch<ChatAction>;
  handleEvent: (event: ProductEvent) => void;
}

export const ChatContext = createContext<ChatContextValue | undefined>(undefined);

export function useChatContext(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChatContext must be used within a ChatProvider');
  }
  return context;
}
