import { useCallback, useEffect, useState } from 'react';
import { ChatProvider, useChatContext } from './ChatContext';
import { useConversationSocket } from './hooks/useConversationSocket';
import {
  createConversation,
  listConversationEvents,
  listConversations,
  sendMessage,
} from './api';
import { ChatPanel } from './components/ChatPanel';
import { MessageInput } from './components/MessageInput';
import { StatusBar } from './components/StatusBar';
import type { ConversationInfo, ExecutionStatus } from './types';

const DEFAULT_USER_IDS = ['42', '7', '1001'];
const USER_IDS_STORAGE_KEY = 'minimal-chat.debugUserIds';

function loadUserIds(): string[] {
  const saved = localStorage.getItem(USER_IDS_STORAGE_KEY);
  if (!saved) {
    return DEFAULT_USER_IDS;
  }
  try {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed.length > 0 ? parsed : DEFAULT_USER_IDS;
    }
  } catch {
    return DEFAULT_USER_IDS;
  }
  return DEFAULT_USER_IDS;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function conversationTitle(conversation: ConversationInfo): string {
  return conversation.title?.trim() || conversation.id.slice(0, 8);
}

function ChatApp() {
  const { state, dispatch, handleEvent } = useChatContext();
  const [userIds, setUserIds] = useState(loadUserIds);
  const [activeUserId, setActiveUserId] = useState(userIds[0] ?? DEFAULT_USER_IDS[0]);
  const [draftUserId, setDraftUserId] = useState('');
  const [conversations, setConversations] = useState<ConversationInfo[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);

  const { wsState } = useConversationSocket({
    conversationId: state.conversationId,
    userId: activeUserId,
    onEvent: handleEvent,
  });

  useEffect(() => {
    localStorage.setItem(USER_IDS_STORAGE_KEY, JSON.stringify(userIds));
  }, [userIds]);

  const openConversation = useCallback(
    async (conversation: ConversationInfo, userId = activeUserId) => {
      dispatch({ type: 'SET_CONVERSATION_ID', id: conversation.id });
      dispatch({
        type: 'SET_STATUS',
        status: conversation.execution_status as ExecutionStatus,
      });
      setIsLoadingEvents(true);
      try {
        const events = await listConversationEvents(conversation.id, { userId });
        dispatch({ type: 'SET_EVENTS', events });
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        setIsLoadingEvents(false);
      }
    },
    [activeUserId, dispatch],
  );

  const refreshConversations = useCallback(
    async (preferredConversationId?: string, userId = activeUserId) => {
      setIsLoadingList(true);
      try {
        const items = await listConversations({ userId });
        setConversations(items);

        const selected =
          (preferredConversationId
            ? items.find((item) => item.id === preferredConversationId)
            : undefined) ?? items[0];
        if (selected) {
          await openConversation(selected, userId);
        } else {
          dispatch({ type: 'RESET_CONVERSATION' });
        }
      } catch (err) {
        setConversations([]);
        dispatch({ type: 'RESET_CONVERSATION' });
        dispatch({
          type: 'SET_ERROR',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        setIsLoadingList(false);
      }
    },
    [activeUserId, dispatch, openConversation],
  );

  useEffect(() => {
    void refreshConversations(undefined, activeUserId);
  }, [activeUserId, refreshConversations]);

  const handleSend = useCallback(
    async (text: string) => {
      setIsSending(true);
      try {
        if (!state.conversationId) {
          const info = await createConversation(text, { userId: activeUserId });
          await refreshConversations(info.id, activeUserId);
        } else {
          await sendMessage(state.conversationId, text, { userId: activeUserId });
          void refreshConversations(state.conversationId, activeUserId);
        }
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        setIsSending(false);
      }
    },
    [activeUserId, dispatch, refreshConversations, state.conversationId],
  );

  const handleAddUser = useCallback(() => {
    const nextUserId = draftUserId.trim();
    if (!/^\d+$/.test(nextUserId)) {
      dispatch({ type: 'SET_ERROR', error: 'User ID must be numeric for the JWT test token.' });
      return;
    }
    setUserIds((current) =>
      current.includes(nextUserId) ? current : [...current, nextUserId],
    );
    setActiveUserId(nextUserId);
    setDraftUserId('');
  }, [dispatch, draftUserId]);

  const selectedConversation = conversations.find(
    (conversation) => conversation.id === state.conversationId,
  );

  return (
    <div className="h-screen flex flex-col bg-white text-left">
      <div className="border-b bg-white px-4 py-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {userIds.map((userId) => (
            <button
              key={userId}
              type="button"
              onClick={() => setActiveUserId(userId)}
              className={`shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium ${
                activeUserId === userId
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              user {userId}
            </button>
          ))}
          <form
            className="ml-auto flex shrink-0 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              handleAddUser();
            }}
          >
            <input
              value={draftUserId}
              onChange={(event) => setDraftUserId(event.target.value)}
              placeholder="custom user id"
              className="w-36 rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
            >
              Add
            </button>
          </form>
        </div>
      </div>

      <StatusBar
        wsState={wsState}
        status={state.status}
        conversationId={state.conversationId}
      />

      {state.error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {state.error}
          <button
            onClick={() => dispatch({ type: 'SET_ERROR', error: null })}
            className="ml-2 underline"
          >
            dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r bg-gray-50">
          <div className="flex items-center justify-between border-b px-3 py-3">
            <div>
              <div className="text-sm font-semibold text-gray-900">User {activeUserId}</div>
              <div className="text-xs text-gray-500">{conversations.length} conversations</div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => dispatch({ type: 'RESET_CONVERSATION' })}
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
              >
                New
              </button>
              <button
                type="button"
                onClick={() => void refreshConversations(undefined, activeUserId)}
                disabled={isLoadingList}
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoadingList && (
              <div className="px-3 py-3 text-xs text-gray-500">Loading...</div>
            )}
            {!isLoadingList && conversations.length === 0 && (
              <div className="px-3 py-6 text-sm text-gray-500">No conversations.</div>
            )}
            {conversations.map((conversation) => {
              const isSelected = conversation.id === state.conversationId;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => void openConversation(conversation, activeUserId)}
                  className={`block w-full border-b px-3 py-3 text-left ${
                    isSelected ? 'bg-white' : 'hover:bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-gray-900">
                      {conversationTitle(conversation)}
                    </span>
                    <span className="shrink-0 text-[11px] uppercase text-gray-400">
                      {conversation.execution_status}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-gray-500">
                    <span className="font-mono">{conversation.id.slice(0, 8)}</span>
                    <span>{formatTime(conversation.updated_at)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-white">
          <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-gray-500">
            <span>
              {selectedConversation
                ? conversationTitle(selectedConversation)
                : 'New conversation'}
            </span>
            {isLoadingEvents && <span>Loading history...</span>}
          </div>

          <ChatPanel events={state.events} />

          <MessageInput
            onSend={handleSend}
            disabled={isSending || state.status === 'running'}
          />
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <ChatProvider>
      <ChatApp />
    </ChatProvider>
  );
}

export default App;
