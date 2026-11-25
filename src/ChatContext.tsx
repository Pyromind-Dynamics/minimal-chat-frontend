import { createContext, useContext, useReducer, useCallback, type ReactNode } from 'react';
import {
  getContextCondensationState,
  type ChatEvent,
  type ConversationSnapshot,
  type ExecutionStatus,
  type PendingOutboundMessage,
  type ProductEvent,
} from './types';
import type { StreamConnectionState } from './types';
import { snapshotToChatEvents } from './productSnapshot';
import { pendingTimelineEvents, projectTimelineEvents, receivedUserCommandIds } from './productMessages';

// State shape
interface ChatState {
  conversationId: string | null;
  snapshot: ConversationSnapshot | null;
  events: ChatEvent[];
  status: ExecutionStatus;
  isCondensing: boolean;
  wsState: StreamConnectionState;
  error: string | null;
  pendingOutboundMessages: PendingOutboundMessage[];
  timelineEvents: ProductEvent[];
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
  | { type: 'SET_WS_STATE'; wsState: StreamConnectionState }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'ADD_PENDING_OUTBOUND'; message: PendingOutboundMessage }
  | { type: 'SET_PENDING_OUTBOUND_STATUS'; commandId: string; status: PendingOutboundMessage['status'] }
  | { type: 'MARK_PENDING_OUTBOUND_FAILED'; commandId: string }
  | { type: 'APPLY_MESSAGE_EVENTS'; events: ProductEvent[] }
  | { type: 'APPLY_OPERATION_EVENT'; event: ProductEvent };

const initialState: ChatState = {
  conversationId: null,
  snapshot: null,
  events: [],
  status: 'idle',
  isCondensing: false,
  wsState: 'closed',
  error: null,
  pendingOutboundMessages: [],
  timelineEvents: [],
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
        timelineEvents: [],
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
        timelineEvents: [],
      };
    case 'SET_PRODUCT_SNAPSHOT': {
      if (state.snapshot?.conversation_id === action.snapshot.conversation_id
        && state.snapshot.through_seq > action.snapshot.through_seq) return state;
      const timelineEvents = pendingTimelineEvents(action.snapshot, state.timelineEvents);
      const projected = projectTimelineEvents(action.snapshot, timelineEvents);
      const completedRunIds = receivedUserCommandIds(projected);
      return {
        ...state,
        conversationId: action.snapshot.conversation_id,
        snapshot: action.snapshot,
        events: snapshotToChatEvents(projected),
        status: action.snapshot.status,
        isCondensing: action.snapshot.compaction_status === 'started',
        error: null,
        pendingOutboundMessages: state.pendingOutboundMessages.filter(
          (message) => !completedRunIds.has(message.commandId),
        ),
        timelineEvents,
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
    case 'SET_PENDING_OUTBOUND_STATUS':
    case 'MARK_PENDING_OUTBOUND_FAILED':
      return {
        ...state,
        pendingOutboundMessages: state.pendingOutboundMessages.map((message) =>
          message.commandId === action.commandId
            ? { ...message, status: action.type === 'MARK_PENDING_OUTBOUND_FAILED' ? 'failed' : action.status }
            : message,
        ),
      };
    case 'APPLY_MESSAGE_EVENTS':
    case 'APPLY_OPERATION_EVENT': {
      if (!state.snapshot) return state;
      const updates = action.type === 'APPLY_MESSAGE_EVENTS' ? action.events : [action.event];
      const timelineEvents = pendingTimelineEvents(state.snapshot, [...state.timelineEvents, ...updates]);
      const projected = projectTimelineEvents(state.snapshot, timelineEvents);
      const receivedCommands = receivedUserCommandIds(projected);
      return {
        ...state, timelineEvents, events: snapshotToChatEvents(projected),
        pendingOutboundMessages: state.pendingOutboundMessages.filter((message) =>
          !receivedCommands.has(message.commandId)),
      };
    }
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

export function ChatProvider({ children, initialSnapshot }: {
  children: ReactNode; initialSnapshot?: ConversationSnapshot | null;
}) {
  const [state, dispatch] = useReducer(chatReducer, initialSnapshot, snapshot =>
    snapshot ? chatReducer(initialState, { type: 'SET_PRODUCT_SNAPSHOT', snapshot }) : initialState);

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
