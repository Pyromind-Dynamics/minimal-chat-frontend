import { createContext, useContext, useReducer, useCallback, type ReactNode } from 'react';
import {
  getContextCondensationState,
  type ChatEvent,
  type ExecutionStatus,
} from './types';
import type { WsState } from './hooks/useConversationSocket';

// State shape
interface ChatState {
  conversationId: string | null;
  events: ChatEvent[];
  status: ExecutionStatus;
  isCondensing: boolean;
  wsState: WsState;
  error: string | null;
}

// Actions
type ChatAction =
  | { type: 'SET_CONVERSATION_ID'; id: string }
  | { type: 'RESET_CONVERSATION' }
  | { type: 'SET_EVENTS'; events: ChatEvent[] }
  | { type: 'ADD_EVENT'; event: ChatEvent }
  | { type: 'CLEAR_EVENTS' }
  | { type: 'SET_STATUS'; status: ExecutionStatus }
  | { type: 'SET_CONDENSING'; isCondensing: boolean }
  | { type: 'SET_WS_STATE'; wsState: WsState }
  | { type: 'SET_ERROR'; error: string | null };

const initialState: ChatState = {
  conversationId: null,
  events: [],
  status: 'idle',
  isCondensing: false,
  wsState: 'closed',
  error: null,
};

function getEventId(event: ChatEvent): string | undefined {
  return 'id' in event ? event.id : undefined;
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_CONVERSATION_ID':
      return {
        ...state,
        conversationId: action.id,
        events: [],
        isCondensing: false,
        error: null,
      };
    case 'RESET_CONVERSATION':
      return {
        ...state,
        conversationId: null,
        events: [],
        status: 'idle',
        isCondensing: false,
        error: null,
      };
    case 'SET_EVENTS':
      return { ...state, events: action.events, error: null };
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
