import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelConversation,
  createConversation,
  getConversationSnapshot,
  listConversations,
  respondToPermission,
  sendUserMessage,
  type RequestOptions,
} from './api';
import { useChatContext } from './ChatContext';
import { ChatProvider } from './ChatProvider';
import { ChatPanel } from './components/ChatPanel';
import { MessageInput } from './components/MessageInput';
import { StatusBar } from './components/StatusBar';
import { useProductEventStream } from './hooks/useProductEventStream';
import type {
  ConversationSnapshot,
  GuidanceStatus,
  ProductEvent,
} from './types';

const DEFAULT_USER_IDS = ['42', '7', '1001'];
const USER_IDS_STORAGE_KEY = 'minimal-chat.debugUserIds';
const REQUEST_OVERRIDES_STORAGE_KEY = 'minimal-chat.requestOverrides';

interface RequestOverrideFields {
  cookie: string;
  xCluster: string;
}

function ChatApp() {
  const { state, dispatch, handleEvent } = useChatContext();
  const [userIds, setUserIds] = useState(loadUserIds);
  const [activeUserId, setActiveUserId] = useState(
    userIds[0] ?? DEFAULT_USER_IDS[0],
  );
  const [draftUserId, setDraftUserId] = useState('');
  const [requestOverrides, setRequestOverrides] = useState(loadRequestOverrides);
  const [draftRequestOverrides, setDraftRequestOverrides] = useState(
    loadRequestOverrides,
  );
  const [conversations, setConversations] = useState<ConversationSnapshot[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRespondingToPermission, setIsRespondingToPermission] = useState(false);
  const [guidanceStatus, setGuidanceStatus] = useState<GuidanceStatus | null>(null);
  const [streamAfterSeq, setStreamAfterSeq] = useState(0);
  const conversationIdRef = useRef<string | null>(null);
  conversationIdRef.current = state.conversationId;

  const requestOptions = useMemo<RequestOptions>(() => ({
    userId: activeUserId,
    cookie: requestOverrides.cookie,
    xCluster: requestOverrides.xCluster,
  }), [activeUserId, requestOverrides.cookie, requestOverrides.xCluster]);

  const handleProductEvent = useCallback((event: ProductEvent) => {
    setGuidanceStatus((current) => {
      if (
        event.type === 'message.completed'
        && event.payload.role === 'user'
        && current === 'waiting'
      ) {
        return 'context';
      }
      if (
        (event.type === 'operation.started'
          || (event.type === 'message.started' && event.payload.role === 'assistant'))
        && current === 'context'
      ) {
        return 'processing';
      }
      return current;
    });
    handleEvent(event);
  }, [handleEvent]);

  const handleSequenceGap = useCallback(async (): Promise<number> => {
    const conversationId = conversationIdRef.current;
    if (!conversationId) return 0;
    const snapshot = await getConversationSnapshot(conversationId, requestOptions);
    dispatch({ type: 'SET_SNAPSHOT', snapshot });
    setStreamAfterSeq(snapshot.through_seq);
    return snapshot.through_seq;
  }, [dispatch, requestOptions]);

  const connectionState = useProductEventStream({
    conversationId: state.conversationId,
    afterSeq: streamAfterSeq,
    requestOptions,
    onEvent: handleProductEvent,
    onGap: handleSequenceGap,
  });

  const openConversation = useCallback(async (
    conversationId: string,
  ): Promise<void> => {
    setIsLoadingSnapshot(true);
    try {
      const snapshot = await getConversationSnapshot(conversationId, requestOptions);
      dispatch({ type: 'SET_SNAPSHOT', snapshot });
      setStreamAfterSeq(snapshot.through_seq);
      setGuidanceStatus(null);
    } catch (error) {
      reportError(dispatch, error);
    } finally {
      setIsLoadingSnapshot(false);
    }
  }, [dispatch, requestOptions]);

  const refreshConversations = useCallback(async (
    preferredConversationId?: string,
  ): Promise<void> => {
    setIsLoadingList(true);
    try {
      const items = await listConversations(requestOptions);
      setConversations(items);
      const selectedId = preferredConversationId
        ?? (items.some((item) => item.conversation_id === conversationIdRef.current)
          ? conversationIdRef.current
          : items[0]?.conversation_id);
      if (selectedId) {
        await openConversation(selectedId);
      } else {
        dispatch({ type: 'RESET_CONVERSATION' });
      }
    } catch (error) {
      setConversations([]);
      dispatch({ type: 'RESET_CONVERSATION' });
      reportError(dispatch, error);
    } finally {
      setIsLoadingList(false);
    }
  }, [dispatch, openConversation, requestOptions]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    localStorage.setItem(USER_IDS_STORAGE_KEY, JSON.stringify(userIds));
  }, [userIds]);

  useEffect(() => {
    localStorage.setItem(
      REQUEST_OVERRIDES_STORAGE_KEY,
      JSON.stringify(requestOverrides),
    );
  }, [requestOverrides]);

  useEffect(() => {
    if (!state.snapshot) return;
    setConversations((current) => {
      const exists = current.some(
        (item) => item.conversation_id === state.snapshot!.conversation_id,
      );
      if (!exists) return [state.snapshot!, ...current];
      return current.map((item) =>
        item.conversation_id === state.snapshot!.conversation_id
          ? state.snapshot!
          : item
      );
    });
  }, [state.snapshot]);

  const handleSend = useCallback(async (text: string): Promise<void> => {
    const steering = state.snapshot?.status === 'running';
    if (steering) setGuidanceStatus('waiting');
    setIsSending(true);
    try {
      let snapshot = state.snapshot;
      if (!snapshot) {
        snapshot = await createConversation(requestOptions);
        dispatch({ type: 'SET_SNAPSHOT', snapshot });
        setStreamAfterSeq(snapshot.through_seq);
      }
      await sendUserMessage(snapshot.conversation_id, text, requestOptions);
    } catch (error) {
      if (steering) setGuidanceStatus('failed');
      reportError(dispatch, error);
    } finally {
      setIsSending(false);
    }
  }, [dispatch, requestOptions, state.snapshot]);

  const handleNewConversation = useCallback(async (): Promise<void> => {
    setIsCreating(true);
    try {
      const snapshot = await createConversation(requestOptions);
      dispatch({ type: 'SET_SNAPSHOT', snapshot });
      setStreamAfterSeq(snapshot.through_seq);
      setGuidanceStatus(null);
    } catch (error) {
      reportError(dispatch, error);
    } finally {
      setIsCreating(false);
    }
  }, [dispatch, requestOptions]);

  const handleCancel = useCallback(async (): Promise<void> => {
    if (!state.conversationId) return;
    setIsCancelling(true);
    try {
      await cancelConversation(state.conversationId, requestOptions);
    } catch (error) {
      reportError(dispatch, error);
    } finally {
      setIsCancelling(false);
    }
  }, [dispatch, requestOptions, state.conversationId]);

  const handlePermission = useCallback(async (
    decision: 'allow_once' | 'deny',
  ): Promise<void> => {
    const permission = state.snapshot?.pending_permissions[0];
    if (!state.conversationId || !permission) return;
    setIsRespondingToPermission(true);
    try {
      await respondToPermission(
        state.conversationId,
        permission.permission_id,
        decision,
        requestOptions,
      );
    } catch (error) {
      reportError(dispatch, error);
    } finally {
      setIsRespondingToPermission(false);
    }
  }, [dispatch, requestOptions, state.conversationId, state.snapshot]);

  const handleAddUser = useCallback(() => {
    const nextUserId = draftUserId.trim();
    if (!/^\d+$/.test(nextUserId)) {
      dispatch({ type: 'SET_ERROR', error: 'User ID must be numeric for dev auth.' });
      return;
    }
    setUserIds((current) => current.includes(nextUserId)
      ? current
      : [...current, nextUserId]
    );
    setActiveUserId(nextUserId);
    setDraftUserId('');
  }, [dispatch, draftUserId]);

  const snapshot = state.snapshot;
  const status = snapshot?.status ?? 'idle';
  const canSteer = snapshot?.capabilities.steer ?? false;
  const canCancel = status === 'running' && (snapshot?.capabilities.cancel ?? false);
  const inputDisabled = isLoadingSnapshot
    || status === 'waiting_permission'
    || status === 'closed'
    || status === 'failed'
    || (status === 'running' && !canSteer);

  return (
    <div className="flex h-screen flex-col bg-white text-left">
      <header className="border-b bg-white px-4 py-3">
        <div className="flex items-center gap-2 overflow-x-auto">
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
              className="w-36 rounded-md border border-gray-200 px-3 py-1.5 text-sm"
            />
            <button type="submit" className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white">
              Add
            </button>
          </form>
        </div>
        <form
          className="mt-2 grid gap-2 sm:grid-cols-[minmax(220px,1fr)_minmax(160px,220px)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            setRequestOverrides({
              cookie: draftRequestOverrides.cookie.trim(),
              xCluster: draftRequestOverrides.xCluster.trim(),
            });
          }}
        >
          <input
            value={draftRequestOverrides.cookie}
            onChange={(event) => setDraftRequestOverrides((current) => ({
              ...current,
              cookie: event.target.value,
            }))}
            placeholder="Cookie override"
            className="rounded-md border border-gray-200 px-3 py-1.5 font-mono text-xs"
          />
          <input
            value={draftRequestOverrides.xCluster}
            onChange={(event) => setDraftRequestOverrides((current) => ({
              ...current,
              xCluster: event.target.value,
            }))}
            placeholder="x-cluster"
            className="rounded-md border border-gray-200 px-3 py-1.5 font-mono text-xs"
          />
          <button type="submit" className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white">
            Apply
          </button>
        </form>
      </header>

      <StatusBar
        connectionState={connectionState}
        status={status}
        conversationId={state.conversationId}
        usage={snapshot?.usage}
      />

      {state.error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {state.error}
          <button
            type="button"
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
                onClick={() => void handleNewConversation()}
                disabled={isCreating}
                className="rounded-md border bg-white px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                {isCreating ? 'Creating...' : 'New'}
              </button>
              <button
                type="button"
                onClick={() => void refreshConversations()}
                disabled={isLoadingList}
                className="rounded-md border bg-white px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoadingList && <div className="px-3 py-3 text-xs text-gray-500">Loading...</div>}
            {!isLoadingList && conversations.length === 0 && (
              <div className="px-3 py-6 text-sm text-gray-500">No conversations.</div>
            )}
            {conversations.map((conversation) => (
              <button
                key={conversation.conversation_id}
                type="button"
                onClick={() => void openConversation(conversation.conversation_id)}
                className={`block w-full border-b px-3 py-3 text-left ${
                  conversation.conversation_id === state.conversationId
                    ? 'bg-white'
                    : 'hover:bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium text-gray-900">
                    {conversation.conversation_id.slice(0, 8)}
                  </span>
                  <span className="text-[11px] uppercase text-gray-400">
                    {conversation.status}
                  </span>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  seq {conversation.through_seq}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-white">
          <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-gray-500">
            <span>{state.conversationId?.slice(0, 8) ?? 'New conversation'}</span>
            <div className="flex items-center gap-2">
              {isLoadingSnapshot && <span>Loading snapshot...</span>}
              {canCancel && (
                <button
                  type="button"
                  onClick={() => void handleCancel()}
                  disabled={isCancelling}
                  className="rounded border border-red-200 px-2 py-1 text-red-700 disabled:opacity-50"
                >
                  {isCancelling ? 'Cancelling...' : 'Cancel'}
                </button>
              )}
            </div>
          </div>

          <ChatPanel
            snapshot={snapshot}
            isRespondingToPermission={isRespondingToPermission}
            onRespondToPermission={(decision) => void handlePermission(decision)}
          />

          <MessageInput
            onSend={(text) => void handleSend(text)}
            status={status}
            sending={isSending}
            disabled={inputDisabled}
            canSteer={canSteer}
            guidanceStatus={guidanceStatus}
          />
        </main>
      </div>
    </div>
  );
}

function loadUserIds(): string[] {
  const saved = localStorage.getItem(USER_IDS_STORAGE_KEY);
  if (!saved) return DEFAULT_USER_IDS;
  try {
    const parsed = JSON.parse(saved) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? parsed
      : DEFAULT_USER_IDS;
  } catch {
    return DEFAULT_USER_IDS;
  }
}

function loadRequestOverrides(): RequestOverrideFields {
  const saved = localStorage.getItem(REQUEST_OVERRIDES_STORAGE_KEY);
  if (!saved) return { cookie: '', xCluster: '' };
  try {
    const parsed = JSON.parse(saved) as Partial<RequestOverrideFields>;
    return {
      cookie: typeof parsed.cookie === 'string' ? parsed.cookie : '',
      xCluster: typeof parsed.xCluster === 'string' ? parsed.xCluster : '',
    };
  } catch {
    return { cookie: '', xCluster: '' };
  }
}

function reportError(
  dispatch: React.Dispatch<
    { type: 'SET_ERROR'; error: string | null }
    | { type: 'RESET_CONVERSATION' }
    | { type: 'SET_SNAPSHOT'; snapshot: ConversationSnapshot }
  >,
  error: unknown,
): void {
  dispatch({
    type: 'SET_ERROR',
    error: error instanceof Error ? error.message : 'Unknown error',
  });
}

function App() {
  return (
    <ChatProvider>
      <ChatApp />
    </ChatProvider>
  );
}

export default App;
