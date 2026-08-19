import { createContext, useContext, useReducer, useCallback, type ReactNode } from 'react';
import {
  getContextCondensationState,
  type ChatEvent,
  type ConversationSnapshot,
  type ExecutionStatus,
  type PendingOutboundMessage,
  type StreamingMessage,
} from './types';
import type { WsState } from './hooks/useConversationSocket';
import { snapshotToChatEvents } from './productSnapshot';

// State shape
interface ChatState {
  conversationId: string | null;
  snapshot: ConversationSnapshot | null;
  events: ChatEvent[];
  status: ExecutionStatus;
  isCondensing: boolean;
  wsState: WsState;
  error: string | null;
  pendingOutboundMessages: PendingOutboundMessage[];
  streamingMessages: Record<string, StreamingMessage>;
}

// Actions
type ChatAction =
  | { type: 'SET_CONVERSATION_ID'; id: string }
  | { type: 'SET_PRODUCT_SNAPSHOT'; snapshot: ConversationSnapshot }
  | { type: 'RESET_CONVERSATION' }
  | { type: 'SET_EVENTS'; events: ChatEvent[] }
  | { type: 'ADD_EVENT'; event: ChatEvent }
  | { type: 'CLEAR_EVENTS' }
  | { type: 'SET_STATUS'; status: ExecutionStatus }
  | { type: 'SET_CONDENSING'; isCondensing: boolean }
  | { type: 'SET_WS_STATE'; wsState: WsState }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'ADD_PENDING_OUTBOUND'; message: PendingOutboundMessage }
  | { type: 'MARK_PENDING_OUTBOUND_FAILED'; commandId: string }
  | { type: 'START_STREAMING_MESSAGE'; message: StreamingMessage }
  | { type: 'APPEND_STREAMING_DELTAS'; deltas: Record<string, string> }
  | { type: 'COMPLETE_STREAMING_MESSAGE'; messageId: string }
  | { type: 'CLEAR_STREAMING_MESSAGES' };

const initialState: ChatState = {
  conversationId: null,
  snapshot: null,
  events: [],
  status: 'idle',
  isCondensing: false,
  wsState: 'closed',
  error: null,
  pendingOutboundMessages: [],
  streamingMessages: {},
};

function getEventId(event: ChatEvent): string | undefined {
  return 'id' in event ? event.id : undefined;
}

// Merge a REST history snapshot with events already in the store (e.g. new
// WebSocket events that arrived while the snapshot request was in flight).
// The snapshot is older, so it goes first; incoming event ids win over
// existing ones to avoid duplicates.
function mergeEvents(existing: ChatEvent[], incoming: ChatEvent[]): ChatEvent[] {
  const seen = new Set<string>();
  const merged: ChatEvent[] = [];
  for (const event of [...incoming, ...existing]) {
    const id = getEventId(event);
    if (id !== undefined) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    merged.push(event);
  }
  return merged;
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_CONVERSATION_ID':
      return {
        ...state,
        conversationId: action.id,
        snapshot: null,
        events: [],
        isCondensing: false,
        error: null,
        pendingOutboundMessages: [],
        streamingMessages: {},
      };
    case 'RESET_CONVERSATION':
      return {
        ...state,
        conversationId: null,
        snapshot: null,
        events: [],
        status: 'idle',
        isCondensing: false,
        error: null,
        pendingOutboundMessages: [],
        streamingMessages: {},
      };
    case 'SET_PRODUCT_SNAPSHOT': {
      const completedRunIds = new Set(
        action.snapshot.timeline.flatMap((item) =>
          item.kind === 'message' && item.run_id ? [item.run_id] : []),
      );
      const reconciledStreaming = Object.fromEntries(
        Object.entries(state.streamingMessages).filter(([messageId, message]) =>
          !action.snapshot.timeline.some(
            (item) => item.kind === 'message'
              && item.status === 'completed'
              && (
                item.item_id === messageId
                || (message.runId !== null && item.run_id === message.runId)
              ),
          ),
        ),
      );
      return {
        ...state,
        conversationId: action.snapshot.conversation_id,
        snapshot: action.snapshot,
        events: snapshotToChatEvents(action.snapshot),
        status: action.snapshot.status,
        isCondensing: action.snapshot.compaction_status === 'started',
        error: null,
        pendingOutboundMessages: state.pendingOutboundMessages.filter(
          (message) => !completedRunIds.has(message.commandId),
        ),
        streamingMessages: reconciledStreaming,
      };
    }
    case 'SET_EVENTS':
      return {
        ...state,
        events: mergeEvents(state.events, action.events),
        error: null,
      };
    case 'ADD_EVENT':
      if (
        getEventId(action.event) &&
        state.events.some((event) => getEventId(event) === getEventId(action.event))
      ) {
        return state;
      }
      return { ...state, events: [...state.events, action.event] };
    case 'CLEAR_EVENTS':
      return { ...state, events: [] };
    case 'SET_STATUS':
      return { ...state, status: action.status };
    case 'SET_CONDENSING':
      return { ...state, isCondensing: action.isCondensing };
    case 'SET_WS_STATE':
      return { ...state, wsState: action.wsState };
    case 'SET_ERROR':
      return { ...state, error: action.error };
    case 'ADD_PENDING_OUTBOUND':
      return {
        ...state,
        pendingOutboundMessages: [
          ...state.pendingOutboundMessages.filter(
            (message) => message.commandId !== action.message.commandId,
          ),
          action.message,
        ],
      };
    case 'MARK_PENDING_OUTBOUND_FAILED':
      return {
        ...state,
        pendingOutboundMessages: state.pendingOutboundMessages.map((message) =>
          message.commandId === action.commandId
            ? { ...message, status: 'failed' }
            : message,
        ),
      };
    case 'START_STREAMING_MESSAGE':
      return {
        ...state,
        streamingMessages: {
          ...state.streamingMessages,
          [action.message.messageId]: {
            ...action.message,
            text: state.streamingMessages[action.message.messageId]?.text
              || action.message.text,
          },
        },
      };
    case 'APPEND_STREAMING_DELTAS': {
      const streamingMessages = { ...state.streamingMessages };
      for (const [messageId, text] of Object.entries(action.deltas)) {
        const message = streamingMessages[messageId];
        if (message) {
          streamingMessages[messageId] = {
            ...message,
            text: message.text + text,
          };
        }
      }
      return { ...state, streamingMessages };
    }
    case 'COMPLETE_STREAMING_MESSAGE': {
      const message = state.streamingMessages[action.messageId];
      if (!message) return state;
      return {
        ...state,
        streamingMessages: {
          ...state.streamingMessages,
          [action.messageId]: { ...message, status: 'completed' },
        },
      };
    }
    case 'CLEAR_STREAMING_MESSAGES':
      return { ...state, streamingMessages: {} };
    default:
      return state;
  }
}

// Context
interface ChatContextType {
  state: ChatState;
  dispatch: React.Dispatch<ChatAction>;
  handleEvent: (event: ChatEvent) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  const handleEvent = useCallback((event: ChatEvent) => {
    const condensationState = getContextCondensationState(event);
    if (condensationState) {
      dispatch({
        type: 'SET_CONDENSING',
        isCondensing: condensationState.status === 'started',
      });
      return;
    }

    // Handle state updates from ConversationStateUpdateEvent
    if (event.kind === 'ConversationStateUpdateEvent') {
      if ((event.key ?? event.field) === 'execution_status') {
        dispatch({ type: 'SET_STATUS', status: event.value as ExecutionStatus });
        return; // Don't add pure state updates to the event list
      }
    }

    // Handle server errors
    if (event.kind === 'ServerErrorEvent') {
      dispatch({ type: 'SET_ERROR', error: `${event.code}: ${event.detail}` });
    }

    // Add all other events to the list
    dispatch({ type: 'ADD_EVENT', event });
  }, []);

  return (
    <ChatContext.Provider value={{ state, dispatch, handleEvent }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChatContext must be used within a ChatProvider');
  }
  return context;
}
