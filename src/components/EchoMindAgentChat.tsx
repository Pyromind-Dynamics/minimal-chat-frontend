import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RequestOptions } from '../api';
import { ChatProvider, useChatContext } from '../ChatContext';
import { useProductEventStream } from '../hooks/useProductEventStream';
import type { EchoMindChatClient } from '../productClient';
import type { ChatEvent, ConversationSnapshot, ProductEvent } from '../types';
import { ChatPanel } from './ChatPanel';
import { EchoMindConversationTimeline } from './EchoMindConversationTimeline';
import { ECHOMIND_MESSAGE_PLACEHOLDER, publicChatEvents } from '../echomindConversationPresentation';
import { MessageInput } from './MessageInput';
import { ProjectChatDrawer } from './ProjectChatDrawer';

interface AgentChatProps {
  client: EchoMindChatClient;
  managerId: string;
  executionEvents: ChatEvent[];
  executionSnapshot: ConversationSnapshot;
  options: RequestOptions;
  onOpenConfirmation: () => void;
  initialSnapshot?: ConversationSnapshot | null;
  onActivity?: (managerId: string, updatedAt: string) => void;
}

export function EchoMindAgentChat(props: AgentChatProps) {
  return <ChatProvider initialSnapshot={props.initialSnapshot}><AgentChat {...props} /></ChatProvider>;
}

function AgentChat({
  client, managerId, executionEvents, executionSnapshot,
  options, onOpenConfirmation, initialSnapshot, onActivity,
}: AgentChatProps) {
  const { state, dispatch } = useChatContext();
  const [stream, setStream] = useState<{ managerId: string; afterSeq: number } | null>(() =>
    initialSnapshot ? { managerId, afterSeq: initialSnapshot.through_seq } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chatId = useRef(initialSnapshot?.conversation_id ?? null);
  const preloadedOptions = useRef(initialSnapshot === undefined ? null : options);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const pendingDeltas = useRef<ProductEvent[]>([]);
  const frame = useRef<number | null>(null);

  const apply = useCallback((id: string, snapshot: ConversationSnapshot) => {
    if (chatId.current !== snapshot.conversation_id) {
      chatId.current = snapshot.conversation_id;
      dispatch({ type: 'SET_CONVERSATION_ID', id: snapshot.conversation_id });
      setStream({ managerId: id, afterSeq: snapshot.through_seq });
    }
    dispatch({ type: 'SET_PRODUCT_SNAPSHOT', snapshot });
    if (snapshot.updated_at) onActivity?.(id, snapshot.updated_at);
  }, [dispatch, onActivity]);

  useEffect(() => {
    if (!managerId || options === preloadedOptions.current) return;
    const controller = new AbortController();
    void client.snapshot(managerId, options, controller.signal).then(snapshot => {
      if (!controller.signal.aborted && snapshot) apply(managerId, snapshot);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(String(failure));
    });
    return () => controller.abort();
  }, [apply, client, managerId, options]);

  const refresh = useCallback(async () => {
    if (!stream) return 0;
    const snapshot = await client.snapshot(stream.managerId, options);
    if (snapshot) apply(stream.managerId, snapshot);
    return snapshot?.through_seq ?? 0;
  }, [apply, client, options, stream]);

  const flushDeltas = useCallback(() => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = null;
    const events = pendingDeltas.current;
    pendingDeltas.current = [];
    if (events.length) dispatch({ type: 'APPLY_MESSAGE_EVENTS', events });
  }, [dispatch]);

  useEffect(() => () => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
  }, []);

  const onEvent = useCallback((event: ProductEvent) => {
    if (event.conversation_id !== chatId.current) return;
    if (event.type === 'message.delta') {
      pendingDeltas.current.push(event);
      if (frame.current === null) frame.current = window.requestAnimationFrame(flushDeltas);
      return;
    }
    flushDeltas();
    if (event.type === 'message.started' || event.type === 'message.completed') {
      dispatch({ type: 'APPLY_MESSAGE_EVENTS', events: [event] });
      if (event.type === 'message.completed') onActivity?.(managerId, event.occurred_at);
      return;
    }
    if (event.type.startsWith('operation.') && typeof event.payload.operation_id === 'string') {
      dispatch({ type: 'APPLY_OPERATION_EVENT', event });
    }
    if (event.type === 'status.changed' || event.type === 'notice.raised'
      || (event.type === 'operation.completed' && event.payload.name === 'queue_echomind_requirement')) {
      void refresh().catch(failure => setError(String(failure)));
    }
  }, [dispatch, flushDeltas, managerId, onActivity, refresh]);

  const eventsUrl = useCallback((_: string, afterSeq: number) => (
    stream ? client.eventsUrl(stream.managerId, afterSeq) : ''
  ), [client, stream]);

  useProductEventStream({
    conversationId: state.conversationId,
    afterSeq: stream?.afterSeq ?? 0,
    requestOptions: options,
    onEvent,
    onGap: refresh,
    eventsUrl,
  });

  const send = async (text: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    const commandId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    try {
      if (!chatId.current) {
        const snapshot = await client.open(managerId, options);
        if (!mounted.current) return;
        apply(managerId, snapshot);
      }
      dispatch({ type: 'ADD_PENDING_OUTBOUND', message: { commandId, text, timestamp, status: 'pending' } });
      const receipt = await client.command(managerId, {
        type: 'user_message', command_id: commandId, content: [{ type: 'text', text }],
      }, options);
      if (receipt.status === 'failed' || receipt.response.accepted === false) {
        throw new Error('服务端未接收消息，请重试。');
      }
      dispatch({ type: 'SET_PENDING_OUTBOUND_STATUS', commandId, status: 'acknowledged' });
    } catch (failure) {
      setError(String(failure));
      dispatch({ type: 'MARK_PENDING_OUTBOUND_FAILED', commandId });
    } finally {
      setBusy(false);
    }
  };

  const interrupt = async () => {
    if (!stream || busy) return;
    setBusy(true);
    try {
      const receipt = await client.command(stream.managerId, { type: 'cancel', command_id: crypto.randomUUID() }, options);
      if (receipt.status === 'failed' || receipt.response.cancelled === false) throw new Error('中断未生效，请重试。');
      await refresh();
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  };

  const messages = useMemo(() => publicChatEvents(state.events), [state.events]);
  return <ProjectChatDrawer
    history={expanded => <>
      <ChatPanel active={expanded} autoScroll="follow" logLabel="EchoMind 对话记录" emptyText="可以继续提问或补充需求。"
        events={messages} requestOptions={options} status={state.status}
        timeline={messages.length > 0 && <EchoMindConversationTimeline projectChat
          events={state.events} executionEvents={executionEvents} snapshot={executionSnapshot}
          options={options} onOpenConfirmation={onOpenConfirmation}
          chatRunning={state.status === 'running'}
          activeRunId={state.status === 'running' ? state.snapshot?.active_run_id : undefined} />}
        conversationId={state.conversationId} isCondensing={state.isCondensing}
        pendingOutboundMessages={state.pendingOutboundMessages} />
      {error && <p role="alert" className="px-4 py-2 text-sm text-red-700">{error}</p>}
      {state.status === 'running' && !busy && <p role="status" className="px-4 py-2 text-xs text-gray-500">
        正在回复…
      </p>}
    </>}
    composer={panel => (
      <MessageInput compact placeholder={ECHOMIND_MESSAGE_PLACEHOLDER}
        runningMode="send" interruptLabel="停止回复" historyPanelId={panel.id}
        onSend={text => { void send(text); }} status={state.status} sending={busy}
        disabled={busy} canInterrupt={state.status === 'running' && !busy}
        onInterrupt={() => { void interrupt(); }} />
    )}
  />;
}
