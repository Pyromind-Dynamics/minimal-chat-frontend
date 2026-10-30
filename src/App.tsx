import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChatProvider, useChatContext } from './ChatContext';
import { useProductEventStream } from './hooks/useProductEventStream';
import {
  cancelProductConversation,
  createProductConversation,
  forkProductConversation,
  getProductSnapshot,
  listProductConversations,
  requestDebugUrl,
  respondToProductPermission,
  respondToProductInput,
  sendProductMessage,
  type DebugUrlResult,
  type RequestOptions,
} from './api';
import { ChatPanel } from './components/ChatPanel';
import { MessageInput } from './components/MessageInput';
import { StatusBar } from './components/StatusBar';
import { EchoMindChat } from './EchoMindChat';
import { formatConversationUpdatedAt, sortConversations } from './conversationList';
import {
  loadRequestOverrides,
  saveRequestOverrides,
} from './requestOverrides';
import {
  type ConversationSnapshot,
  type GuidanceStatus,
  type ProductEvent,
  type RespondToUserInput,
} from './types';

const DEFAULT_USER_IDS = ['42', '7', '1001'];
const USER_IDS_STORAGE_KEY = 'minimal-chat.debugUserIds';
const ACTIVE_USER_STORAGE_KEY = 'minimal-chat.activeUserId';
const SELECTED_CONVERSATION_KEY = 'minimal-chat.selectedConversation.';

interface PendingInitialCommand {
  conversationId: string;
  commandId: string;
  text: string;
  requestOptions: RequestOptions;
  userId: string;
}

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

function conversationTitle(conversation: ConversationSnapshot): string {
  const firstMessage = conversation.timeline.find(
    (item) => item.kind === 'message' && item.role === 'user',
  );
  if (firstMessage?.kind === 'message') {
    const text = firstMessage.content.find((item) => item.type === 'text');
    if (text?.type === 'text' && text.text.trim()) {
      return text.text.trim().slice(0, 40);
    }
  }
  return conversation.conversation_id.slice(0, 8);
}

function ChatApp() {
  const { state, dispatch } = useChatContext();
  const [userIds, setUserIds] = useState(loadUserIds);
  const [activeUserId, setActiveUserId] = useState(() => {
    const saved = localStorage.getItem(ACTIVE_USER_STORAGE_KEY);
    return saved && userIds.includes(saved) ? saved : userIds[0] ?? DEFAULT_USER_IDS[0];
  });
  const [draftUserId, setDraftUserId] = useState('');
  const [requestOverrides, setRequestOverrides] = useState(loadRequestOverrides);
  const [draftRequestOverrides, setDraftRequestOverrides] = useState(loadRequestOverrides);
  const [conversations, setConversations] = useState<ConversationSnapshot[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [interruptingConversationId, setInterruptingConversationId] = useState<string | null>(null);
  const interruptRequestsRef = useRef(new Set<string>());
  const hasPendingInput = (state.snapshot?.pending_inputs?.length ?? 0) > 0;
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [pendingInitialCommand, setPendingInitialCommand] =
    useState<PendingInitialCommand | null>(null);
  const [hasConnectedStream, setHasConnectedStream] = useState(false);
  const [guidanceStatus, setGuidanceStatus] = useState<GuidanceStatus | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [isRespondingToConfirmation, setIsRespondingToConfirmation] =
    useState(false);
  const [rollingBackWorkflowEventId, setRollingBackWorkflowEventId] = useState<
    string | null
  >(null);
  const [debugUrl, setDebugUrl] = useState('');
  const [debugUrlResult, setDebugUrlResult] = useState<DebugUrlResult | null>(null);
  const [isRequestingDebugUrl, setIsRequestingDebugUrl] = useState(false);
  const [streamAfterSeq, setStreamAfterSeq] = useState(0);
  const snapshotRefreshTimerRef = useRef<number | null>(null);
  const deltaBufferRef = useRef<ProductEvent[]>([]);
  const deltaFrameRef = useRef<number | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const latestSnapshotRef = useRef<{
    conversationId: string;
    throughSeq: number;
  } | null>(null);
  const openConversationRequestRef = useRef(0);
  conversationIdRef.current = state.conversationId;

  useEffect(() => {
    setGuidanceStatus(null);
  }, [state.conversationId]);

  useEffect(() => {
    localStorage.setItem(USER_IDS_STORAGE_KEY, JSON.stringify(userIds));
  }, [userIds]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_USER_STORAGE_KEY, activeUserId);
  }, [activeUserId]);

  useEffect(() => {
    saveRequestOverrides(requestOverrides);
  }, [requestOverrides]);

  useEffect(() => () => {
    if (snapshotRefreshTimerRef.current !== null) {
      window.clearTimeout(snapshotRefreshTimerRef.current);
    }
    if (deltaFrameRef.current !== null) {
      window.cancelAnimationFrame(deltaFrameRef.current);
    }
  }, []);

  const getRequestOptions = useCallback(
    (userId = activeUserId): RequestOptions => ({
      userId,
      cookie: requestOverrides.cookie,
      xCluster: requestOverrides.xCluster,
    }),
    [activeUserId, requestOverrides.cookie, requestOverrides.xCluster],
  );

  const productRequestOptions = useMemo(
    () => getRequestOptions(activeUserId),
    [activeUserId, getRequestOptions],
  );

  const applySnapshot = useCallback(
    (snapshot: ConversationSnapshot, resetStream: boolean) => {
      const latest = latestSnapshotRef.current;
      if (
        latest?.conversationId === snapshot.conversation_id
        && latest.throughSeq > snapshot.through_seq
      ) {
        return;
      }
      latestSnapshotRef.current = {
        conversationId: snapshot.conversation_id,
        throughSeq: snapshot.through_seq,
      };
      dispatch({ type: 'SET_PRODUCT_SNAPSHOT', snapshot });
      if (resetStream) setStreamAfterSeq(snapshot.through_seq);
      setConversations((current) => {
        const remaining = current.filter(
          (item) => item.conversation_id !== snapshot.conversation_id,
        );
        return sortConversations([snapshot, ...remaining]);
      });
    },
    [dispatch],
  );

  const refreshCurrentSnapshot = useCallback(async (): Promise<number> => {
    const conversationId = conversationIdRef.current;
    if (!conversationId) return 0;
    const snapshot = await getProductSnapshot(
      conversationId,
      productRequestOptions,
    );
    if (conversationIdRef.current !== conversationId) {
      return 0;
    }
    applySnapshot(snapshot, false);
    return snapshot.through_seq;
  }, [applySnapshot, productRequestOptions]);

  const flushStreamingDeltas = useCallback(() => {
    if (deltaFrameRef.current !== null) {
      window.cancelAnimationFrame(deltaFrameRef.current);
      deltaFrameRef.current = null;
    }
    const deltas = deltaBufferRef.current;
    deltaBufferRef.current = [];
    if (deltas.length > 0) {
      dispatch({ type: 'APPLY_MESSAGE_EVENTS', events: deltas });
    }
  }, [dispatch]);

  const handleProductEvent = useCallback(
    (event: ProductEvent) => {
      setGuidanceStatus((current) => {
        if (event.type === 'message.completed' && event.payload.role === 'user') {
          return current === 'waiting' ? 'context' : current;
        }
        if (
          event.type === 'operation.started'
          || (event.type === 'message.started'
            && event.payload.role === 'assistant')
        ) {
          return current === 'context' ? 'processing' : current;
        }
        return current;
      });
      if (event.type === 'message.delta') {
        deltaBufferRef.current.push(event);
        if (deltaFrameRef.current === null) {
          deltaFrameRef.current = window.requestAnimationFrame(flushStreamingDeltas);
        }
        return;
      }
      if (event.type === 'message.started' || event.type === 'message.completed') {
        flushStreamingDeltas();
        dispatch({ type: 'APPLY_MESSAGE_EVENTS', events: [event] });
        if (event.type === 'message.started') return;
      }
      if (snapshotRefreshTimerRef.current !== null) {
        window.clearTimeout(snapshotRefreshTimerRef.current);
      }
      snapshotRefreshTimerRef.current = window.setTimeout(() => {
        snapshotRefreshTimerRef.current = null;
        void refreshCurrentSnapshot().catch((error) => {
          dispatch({
            type: 'SET_ERROR',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });
      }, 0);
    },
    [dispatch, flushStreamingDeltas, refreshCurrentSnapshot],
  );

  const handleStreamGap = useCallback(async (): Promise<number> => {
    flushStreamingDeltas();
    return refreshCurrentSnapshot();
  }, [flushStreamingDeltas, refreshCurrentSnapshot]);

  const wsState = useProductEventStream({
    conversationId: state.conversationId,
    afterSeq: streamAfterSeq,
    requestOptions: productRequestOptions,
    onEvent: handleProductEvent,
    onGap: handleStreamGap,
  });

  useEffect(() => {
    setHasConnectedStream(false);
  }, [state.conversationId]);

  useEffect(() => {
    if (wsState === 'open') setHasConnectedStream(true);
  }, [wsState]);


  const openConversation = useCallback(
    async (conversation: ConversationSnapshot, userId = activeUserId) => {
      const requestId = openConversationRequestRef.current + 1;
      openConversationRequestRef.current = requestId;
      setStreamAfterSeq(conversation.through_seq);
      if (conversation.conversation_id !== conversationIdRef.current) {
        dispatch({
          type: 'SET_CONVERSATION_ID',
          id: conversation.conversation_id,
        });
      }
      setIsLoadingEvents(true);
      try {
        const snapshot = await getProductSnapshot(
          conversation.conversation_id,
          getRequestOptions(userId),
        );
        if (openConversationRequestRef.current !== requestId) {
          return;
        }
        applySnapshot(snapshot, true);
        localStorage.setItem(SELECTED_CONVERSATION_KEY + userId, snapshot.conversation_id);
      } catch (err) {
        if (openConversationRequestRef.current !== requestId) {
          return;
        }
        dispatch({
          type: 'SET_ERROR',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        if (openConversationRequestRef.current === requestId) {
          setIsLoadingEvents(false);
        }
      }
    },
    [activeUserId, applySnapshot, dispatch, getRequestOptions],
  );

  const refreshConversations = useCallback(
    async (preferredConversationId?: string, userId = activeUserId) => {
      setIsLoadingList(true);
      try {
        const items = sortConversations(
          await listProductConversations(getRequestOptions(userId)),
        );
        setConversations(items);

        const preferred = preferredConversationId || localStorage.getItem(SELECTED_CONVERSATION_KEY + userId);
        const selected =
          (preferred
            ? items.find(
                (item) => item.conversation_id === preferred,
              )
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
    [activeUserId, dispatch, getRequestOptions, openConversation],
  );

  const refreshConversationList = useCallback(
    async (userId = activeUserId) => {
      setIsLoadingList(true);
      try {
        setConversations(
          sortConversations(await listProductConversations(getRequestOptions(userId))),
        );
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        setIsLoadingList(false);
      }
    },
    [activeUserId, dispatch, getRequestOptions],
  );

  useEffect(() => {
    if (
      wsState !== 'open'
      || !pendingInitialCommand
      || state.conversationId !== pendingInitialCommand.conversationId
    ) {
      return;
    }
    const command = pendingInitialCommand;
    setPendingInitialCommand(null);
    void sendProductMessage(
      command.conversationId,
      command.text,
      command.requestOptions,
      command.commandId,
    ).catch((err) => {
      dispatch({
        type: 'MARK_PENDING_OUTBOUND_FAILED',
        commandId: command.commandId,
      });
      dispatch({
        type: 'SET_ERROR',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }).finally(() => {
      setIsSending(false);
      void refreshConversationList(command.userId);
    });
  }, [
    dispatch,
    pendingInitialCommand,
    refreshConversationList,
    state.conversationId,
    wsState,
  ]);

  useEffect(() => {
    void refreshConversations(undefined, activeUserId);
  }, [activeUserId, refreshConversations]);

  const handleSend = useCallback(
    async (text: string) => {
      if (hasPendingInput) return;
      const isGuidance = state.status === 'running';
      if (isGuidance) {
        setGuidanceStatus('waiting');
      }
      const commandId = crypto.randomUUID();
      dispatch({
        type: 'ADD_PENDING_OUTBOUND',
        message: { commandId, text, status: 'pending' },
      });
      setIsSending(true);
      let sendDeferredUntilStreamOpens = false;
      try {
        const requestOptions = getRequestOptions(activeUserId);
        if (!state.conversationId) {
          setIsCreatingConversation(true);
          const snapshot = await createProductConversation(undefined, requestOptions, true);
          applySnapshot(snapshot, true);
          localStorage.setItem(SELECTED_CONVERSATION_KEY + activeUserId, snapshot.conversation_id);
          setPendingInitialCommand({
            conversationId: snapshot.conversation_id,
            commandId,
            text,
            requestOptions,
            userId: activeUserId,
          });
          sendDeferredUntilStreamOpens = true;
        } else {
          await sendProductMessage(
            state.conversationId,
            text,
            requestOptions,
            commandId,
          );
          if (isGuidance) {
            setGuidanceStatus((current) =>
              current === 'waiting' ? 'context' : current,
            );
          }
        }
      } catch (err) {
        dispatch({ type: 'MARK_PENDING_OUTBOUND_FAILED', commandId });
        if (isGuidance) {
          setGuidanceStatus('failed');
        }
        dispatch({
          type: 'SET_ERROR',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        setIsCreatingConversation(false);
        if (!sendDeferredUntilStreamOpens) setIsSending(false);
      }
    },
    [
      activeUserId,
      applySnapshot,
      dispatch,
      getRequestOptions,
      state.conversationId,
      state.status,
      hasPendingInput,
    ],
  );

  const handleInterrupt = useCallback(async () => {
    const conversationId = state.conversationId;
    if (
      !conversationId
      || !state.snapshot?.capabilities.cancel
      || !['running', 'waiting_for_confirmation'].includes(state.status)
      || isLoadingEvents
      || isSending
      || isRespondingToConfirmation
      || interruptRequestsRef.current.has(conversationId)
    ) return;

    interruptRequestsRef.current.add(conversationId);
    setInterruptingConversationId(conversationId);
    try {
      const requestOptions = getRequestOptions(activeUserId);
      const receipt = await cancelProductConversation(conversationId, requestOptions);
      if (receipt.status === 'failed') {
        throw new Error('中断失败，请重试。');
      }
      const snapshot = await getProductSnapshot(conversationId, requestOptions);
      if (conversationIdRef.current !== conversationId) return;
      applySnapshot(snapshot, false);
      setGuidanceStatus(null);
    } catch (err) {
      if (conversationIdRef.current === conversationId) {
        dispatch({
          type: 'SET_ERROR',
          error: err instanceof Error ? err.message : '中断失败，请重试。',
        });
      }
    } finally {
      interruptRequestsRef.current.delete(conversationId);
      setInterruptingConversationId((current) => current === conversationId ? null : current);
    }
  }, [
    activeUserId, applySnapshot, dispatch, getRequestOptions, isLoadingEvents,
    isRespondingToConfirmation, isSending, state.conversationId, state.snapshot,
    state.status,
  ]);

  const handleRespondToUserInput = useCallback<RespondToUserInput>(
    async (requestId, status, answers, commandId) => {
      const conversationId = state.conversationId;
      if (!conversationId) throw new Error('未选择会话');
      const options = getRequestOptions(activeUserId);
      try {
        const receipt = await respondToProductInput(conversationId, requestId, status, answers, options, commandId);
        if (receipt.status === 'failed') throw new Error(JSON.stringify(receipt.response));
      } finally {
        const snapshot = await getProductSnapshot(conversationId, options);
        if (conversationIdRef.current === conversationId) applySnapshot(snapshot, false);
      }
    },
    [state.conversationId, activeUserId, getRequestOptions, applySnapshot],
  );

  const handleRespondToConfirmation = useCallback(
    async (accept: boolean) => {
      if (!state.conversationId) {
        dispatch({ type: 'SET_ERROR', error: 'Select a conversation first.' });
        return;
      }
      const permission = state.snapshot?.pending_permissions[0];
      if (!permission) {
        dispatch({ type: 'SET_ERROR', error: 'No pending permission found.' });
        return;
      }

      setIsRespondingToConfirmation(true);
      try {
        await respondToProductPermission(
          state.conversationId,
          permission.permission_id,
          accept,
          getRequestOptions(activeUserId),
        );
        if (!accept) {
          dispatch({ type: 'SET_STATUS', status: 'idle' });
        }
        await refreshCurrentSnapshot();
      } catch (err) {
        dispatch({ type: 'SET_STATUS', status: 'waiting_for_confirmation' });
        dispatch({
          type: 'SET_ERROR',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        setIsRespondingToConfirmation(false);
      }
    },
    [
      activeUserId,
      dispatch,
      getRequestOptions,
      refreshCurrentSnapshot,
      state.conversationId,
      state.snapshot,
    ],
  );
  const handleRollbackWorkflow = useCallback(
    async (eventId: string) => {
      if (!state.conversationId) {
        dispatch({ type: 'SET_ERROR', error: 'Select a conversation first.' });
        return;
      }
      setRollingBackWorkflowEventId(eventId);
      try {
        const snapshot = await forkProductConversation(
          state.conversationId,
          eventId,
          getRequestOptions(activeUserId),
        );
        applySnapshot(snapshot, true);
        void refreshConversations(snapshot.conversation_id, activeUserId);
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        setRollingBackWorkflowEventId(null);
      }
    },
    [
      activeUserId,
      applySnapshot,
      dispatch,
      getRequestOptions,
      refreshConversations,
      state.conversationId,
    ],
  );

  const handleNewConversation = useCallback(() => {
    openConversationRequestRef.current += 1;
    conversationIdRef.current = null;
    latestSnapshotRef.current = null;
    if (snapshotRefreshTimerRef.current !== null) {
      window.clearTimeout(snapshotRefreshTimerRef.current);
      snapshotRefreshTimerRef.current = null;
    }
    setStreamAfterSeq(0);
    setIsLoadingEvents(false);
    setGuidanceStatus(null);
    setPendingInitialCommand(null);
    setIsSending(false);
    dispatch({ type: 'RESET_CONVERSATION' });
  }, [dispatch]);

  const handleAddUser = useCallback(() => {
    const nextUserId = draftUserId.trim();
    if (!/^\d+$/.test(nextUserId)) {
      dispatch({ type: 'SET_ERROR', error: 'User ID must be numeric for dev auth.' });
      return;
    }
    setUserIds((current) =>
      current.includes(nextUserId) ? current : [...current, nextUserId],
    );
    setActiveUserId(nextUserId);
    setDraftUserId('');
  }, [dispatch, draftUserId]);

  const handleApplyRequestOverrides = useCallback(() => {
    setRequestOverrides({
      cookie: draftRequestOverrides.cookie.trim(),
      xCluster: draftRequestOverrides.xCluster.trim(),
    });
  }, [draftRequestOverrides.cookie, draftRequestOverrides.xCluster]);

  const handleRequestDebugUrl = useCallback(async () => {
    const url = debugUrl.trim();
    if (!url) {
      dispatch({ type: 'SET_ERROR', error: 'Test URL is required.' });
      return;
    }
    if (!state.conversationId) {
      dispatch({ type: 'SET_ERROR', error: 'Select or create a conversation first.' });
      return;
    }

    const nextOverrides = {
      cookie: draftRequestOverrides.cookie.trim(),
      xCluster: draftRequestOverrides.xCluster.trim(),
    };
    setRequestOverrides(nextOverrides);
    setIsRequestingDebugUrl(true);
    setDebugUrlResult(null);
    try {
      setDebugUrlResult(
        await requestDebugUrl(
          url,
          state.conversationId,
          {
            userId: activeUserId,
            cookie: nextOverrides.cookie,
            xCluster: nextOverrides.xCluster,
          },
        ),
      );
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setIsRequestingDebugUrl(false);
    }
  }, [
    activeUserId,
    debugUrl,
    dispatch,
    draftRequestOverrides.cookie,
    draftRequestOverrides.xCluster,
    state.conversationId,
  ]);

  const selectedConversation = conversations.find(
    (conversation) => conversation.conversation_id === state.conversationId,
  );
  const isInterrupting = interruptingConversationId !== null
    && interruptingConversationId === state.conversationId;

  return (
    <div className="h-screen flex flex-col bg-white text-left">
      <div className="border-b bg-white px-4 py-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">Workbench Chat</div>
            <div className="mt-0.5 text-xs text-gray-500">
              Development
            </div>
          </div>
          <a
            href={`?chat=echomind&userId=${encodeURIComponent(activeUserId)}`}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            打开 EchoMind Manager
          </a>
        </div>
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
        <form
          className="grid gap-2 pt-2 sm:grid-cols-[minmax(220px,1fr)_minmax(160px,220px)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            handleApplyRequestOverrides();
          }}
        >
          <label className="min-w-0">
            <span className="mb-1 block text-xs font-medium text-gray-500">Cookie</span>
            <input
              value={draftRequestOverrides.cookie}
              onChange={(event) =>
                setDraftRequestOverrides((current) => ({
                  ...current,
                  cookie: event.target.value,
                }))
              }
              placeholder="name=value; other=value"
              spellCheck={false}
              autoCapitalize="off"
              className="w-full rounded-md border border-gray-200 px-3 py-1.5 font-mono text-xs outline-none focus:border-blue-500"
            />
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-xs font-medium text-gray-500">x-cluster</span>
            <input
              value={draftRequestOverrides.xCluster}
              onChange={(event) =>
                setDraftRequestOverrides((current) => ({
                  ...current,
                  xCluster: event.target.value,
                }))
              }
              placeholder="cluster"
              spellCheck={false}
              autoCapitalize="off"
              className="w-full rounded-md border border-gray-200 px-3 py-1.5 font-mono text-xs outline-none focus:border-blue-500"
            />
          </label>
          <button
            type="submit"
            className="self-end rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
          >
            Apply
          </button>
        </form>
        <form
          className="grid gap-2 pt-2 sm:grid-cols-[minmax(260px,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void handleRequestDebugUrl();
          }}
        >
          <label className="min-w-0">
            <span className="mb-1 block text-xs font-medium text-gray-500">Test URL</span>
            <input
              value={debugUrl}
              onChange={(event) => setDebugUrl(event.target.value)}
              placeholder="https://example.test/debug"
              spellCheck={false}
              autoCapitalize="off"
              className="w-full rounded-md border border-gray-200 px-3 py-1.5 font-mono text-xs outline-none focus:border-blue-500"
            />
          </label>
          <button
            type="submit"
            disabled={isRequestingDebugUrl}
            className="self-end rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {isRequestingDebugUrl ? 'Requesting...' : 'Request'}
          </button>
        </form>
        {debugUrlResult && (
          <div className="mt-2 grid gap-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700 sm:grid-cols-[220px_1fr]">
            <div className="min-w-0">
              <div className="font-medium text-gray-900">
                Status {debugUrlResult.status_code}
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                {debugUrlResult.context_source}
                {debugUrlResult.conversation_id
                  ? ` ${debugUrlResult.conversation_id.slice(0, 8)}`
                  : ''}
              </div>
              <pre className="mt-1 max-h-24 overflow-auto rounded border border-gray-200 bg-white p-2 font-mono text-[11px]">
                {JSON.stringify(debugUrlResult.forwarded_headers, null, 2)}
              </pre>
            </div>
            <pre className="max-h-28 min-w-0 overflow-auto rounded border border-gray-200 bg-white p-2 font-mono text-[11px]">
              {debugUrlResult.body || '(empty body)'}
            </pre>
          </div>
        )}
      </div>

      <StatusBar
        wsState={wsState}
        status={state.status}
        conversationId={state.conversationId}
        isCreating={isCreatingConversation}
        hasConnected={hasConnectedStream}
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
                onClick={handleNewConversation}
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
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
              const isSelected =
                conversation.conversation_id === state.conversationId;
              return (
                <button
                  key={conversation.conversation_id}
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
                      {conversation.status}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-gray-500">
                    <span className="font-mono">
                      {conversation.conversation_id.slice(0, 8)}
                    </span>
                    <time
                      className="shrink-0 text-right"
                      dateTime={conversation.updated_at ?? undefined}
                      title={`更新时间：${formatConversationUpdatedAt(conversation.updated_at)}`}
                    >
                      {formatConversationUpdatedAt(conversation.updated_at)}
                    </time>
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

          <ChatPanel
            events={state.events}
            pendingPermission={state.snapshot?.pending_permissions[0]}
            pendingOutboundMessages={state.pendingOutboundMessages}
            conversationId={state.conversationId}
            pendingInputs={state.snapshot?.pending_inputs}
            onRespondToUserInput={handleRespondToUserInput}
            status={state.status}
            isCondensing={state.isCondensing}
            requestOptions={getRequestOptions()}
            onRollbackWorkflow={handleRollbackWorkflow}
            rollbackWorkflowDisabled={
              isSending
              || isLoadingEvents
              || hasPendingInput
              || state.status === 'running'
              || rollingBackWorkflowEventId !== null
            }
            rollingBackWorkflowEventId={rollingBackWorkflowEventId}
            isRespondingToConfirmation={isRespondingToConfirmation || isInterrupting}
            onRespondToConfirmation={handleRespondToConfirmation}
          />

          {hasPendingInput ? (
            <p className="border-t border-indigo-100 bg-indigo-50/70 px-4 py-2.5 text-xs leading-5 text-indigo-700">请在上方卡片完成回答，或取消提问后继续聊天。</p>
          ) : state.snapshot?.automatic_turns_suspended && (
            <p className="border-t bg-amber-50 px-4 py-2 text-xs text-amber-800">自动执行已暂停。发送一条新消息后继续。</p>
          )}
          <MessageInput
            onSend={handleSend}
            onInterrupt={handleInterrupt}
            canInterrupt={
              Boolean(state.conversationId && state.snapshot?.capabilities.cancel)
              && (state.status === 'running' || state.status === 'waiting_for_confirmation')
              && !isLoadingEvents
              && !isSending
              && !isRespondingToConfirmation
            }
            interrupting={isInterrupting}
            status={state.status}
            sending={isSending}
            disabled={
              isLoadingEvents
              || hasPendingInput
              || isRespondingToConfirmation
              || state.status === 'deleting'
              || state.status === 'waiting_for_confirmation'
              || Boolean(state.snapshot?.pending_permissions.length)
            }
            guidanceStatus={guidanceStatus}
          />
        </main>
      </div>
    </div>
  );
}

function App() {
  const chatMode = new URLSearchParams(window.location.search).get('chat');
  const isEchoMindChat = chatMode === 'echomind';

  return (
    <ChatProvider>
      {isEchoMindChat ? <EchoMindChat /> : <ChatApp />}
    </ChatProvider>
  );
}

export default App;
