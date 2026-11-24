import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RequestOptions } from '../api';
import { ChatProvider, useChatContext } from '../ChatContext';
import { useProductEventStream } from '../hooks/useProductEventStream';
import type { EchoMindChatClient } from '../productClient';
import type { ConversationSnapshot, ProductEvent } from '../types';
import { ChatPanel } from './ChatPanel';
import { hasVisibleMessage } from '../echomindConversationPresentation';
import { MessageInput } from './MessageInput';

interface AgentChatProps {
  client: EchoMindChatClient;
  managerId: string;
  options: RequestOptions;
  disabled: boolean;
}

export function EchoMindAgentChat(props: AgentChatProps) {
  return <ChatProvider><AgentChat {...props} /></ChatProvider>;
}

function AgentChat({
  client, managerId, options, disabled,
}: AgentChatProps) {
  const { state, dispatch } = useChatContext();
  const [stream, setStream] = useState<{ managerId: string; afterSeq: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chatId = useRef<string | null>(null);
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
  }, [dispatch]);

  useEffect(() => {
    if (!managerId) return;
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
      return;
    }
    if (event.type === 'status.changed' || event.type === 'notice.raised'
      || (event.type === 'operation.completed' && event.payload.name === 'queue_echomind_requirement')) {
      void refresh().catch(failure => setError(String(failure)));
    }
  }, [dispatch, flushDeltas, refresh]);

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
    if (disabled || busy) return;
    setBusy(true);
    setExpanded(true);
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
      await client.command(stream.managerId, { type: 'cancel', command_id: crypto.randomUUID() }, options);
      await refresh();
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  };

  const messages = useMemo(() => state.events.filter(event =>
    event.kind === 'ServerErrorEvent' || (hasVisibleMessage(event) && !event.execution_notice
      && (event.llm_message.role === 'user' || event.llm_message.role === 'assistant'))
  ), [state.events]);
  const hasHistory = messages.length > 0 || state.pendingOutboundMessages.length > 0 || !!error;
  return <section aria-label="Chat Agent" className={`mt-auto flex min-h-0 flex-col border-t bg-white ${expanded ? 'h-[min(40vh,24rem)]' : 'shrink-0'}`}>
    {expanded && <>
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-2 text-sm">
        <strong>Chat Agent</strong>
        <button type="button" aria-expanded="true" onClick={() => setExpanded(false)}
          className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100">最小化</button>
      </header>
      <ChatPanel autoScroll="follow" logLabel="Chat Agent 对话记录" emptyText="可以继续提问或补充需求。"
        events={messages} requestOptions={options} status={state.status}
        conversationId={state.conversationId} isCondensing={state.isCondensing}
        pendingOutboundMessages={state.pendingOutboundMessages} />
    </>}
    {error && <p role="alert" className="px-4 py-2 text-sm text-red-700">{error}</p>}
    <MessageInput compact placeholder="向 Chat Agent 提问或补充需求…"
      onExpand={!expanded && hasHistory ? () => setExpanded(true) : undefined}
      runningMode="send" interruptLabel="停止回复"
      onSend={text => { void send(text); }} status={state.status} sending={busy}
      disabled={disabled || busy} canInterrupt={expanded && state.status === 'running' && !busy}
      onInterrupt={() => { void interrupt(); }} />
  </section>;
}
