import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import type { RequestOptions } from '../api';
import { ChatProvider, useChatContext } from '../ChatContext';
import { useProductEventStream } from '../hooks/useProductEventStream';
import type { EchoMindChatClient } from '../productClient';
import { getLatestPlan, type ChatEvent, type ConversationSnapshot, type ProductEvent } from '../types';
import { ChatEventList, ChatPanel } from './ChatPanel';
import { groupEchoMindTurns, hasVisibleMessage } from '../echomindConversationPresentation';
import { MessageInput } from './MessageInput';
import { PreparationWelcome } from './PreparationWelcome';
import { MessageBubble } from './MessageBubble';
import { PlanBlock } from './PlanBlock';

interface AgentChatProps {
  client: EchoMindChatClient;
  managerId: string | null;
  ensureManager: () => Promise<string>;
  options: RequestOptions;
  disabled: boolean;
  executionEvents: ChatEvent[];
  executionSnapshot: ConversationSnapshot | null;
  executionIsCondensing: boolean;
  panel: Pick<ComponentProps<typeof ChatPanel>,
    'children' | 'contentKey' | 'pendingPermission' | 'pendingInputs' | 'isRespondingToConfirmation'
    | 'onRespondToConfirmation' | 'onRespondToUserInput' | 'readInputMedia'>;
}

export function EchoMindAgentChat(props: AgentChatProps) {
  return <ChatProvider><AgentChat {...props} /></ChatProvider>;
}

function AgentChat({
  client, managerId, ensureManager, options, disabled,
  executionEvents, executionSnapshot, executionIsCondensing, panel,
}: AgentChatProps) {
  const { state, dispatch } = useChatContext();
  const [stream, setStream] = useState<{ managerId: string; afterSeq: number } | null>(null);
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
    setError('');
    const commandId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    try {
      const id = managerId ?? await ensureManager();
      if (!mounted.current) return;
      if (!chatId.current) {
        const snapshot = await client.open(id, options);
        if (!mounted.current) return;
        apply(id, snapshot);
      }
      dispatch({ type: 'ADD_PENDING_OUTBOUND', message: { commandId, text, timestamp, status: 'pending' } });
      const receipt = await client.command(id, {
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

  const groups = useMemo(() => groupEchoMindTurns(state.events, executionEvents, executionSnapshot),
    [state.events, executionEvents, executionSnapshot]);
  const timeline = groups.turns.length || groups.leading.length || groups.background.length ? <>
    <ChatEventList events={groups.leading} requestOptions={options} />
    {groups.turns.map(turn => <article key={turn.id} className="mb-5 last:mb-0">
      <ChatEventList events={turn.messages} requestOptions={options} />
      <TurnExecution events={turn.execution} queued={turn.queued} options={options} />
    </article>)}
    {groups.background.length > 0 && (
      <ExecutionDetails label="会话执行记录" events={groups.background} options={options} />
    )}
  </> : undefined;
  return <section aria-label="EchoMind 对话" className="flex min-h-48 flex-1 flex-col">
    {!state.conversationId && !managerId ? <PreparationWelcome /> : <ChatPanel
      {...panel} autoScroll="follow" logLabel="对话与执行进展" emptyText="可以继续补充需求或查询进度。"
      events={state.events} timeline={timeline} requestOptions={options} status={state.status}
      conversationId={state.conversationId} isCondensing={state.isCondensing || executionIsCondensing}
      pendingOutboundMessages={state.pendingOutboundMessages} />}
    {error && <p role="alert" className="px-4 py-2 text-sm text-red-700">{error}</p>}
    <MessageInput
      runningMode="send" interruptLabel="停止回复"
      onSend={text => { void send(text); }} status={state.status} sending={busy}
      disabled={disabled || busy} canInterrupt={state.status === 'running' && !busy}
      onInterrupt={() => { void interrupt(); }} />
  </section>;
}

function TurnExecution({ events, queued, options }: {
  events: ChatEvent[]; queued: boolean; options: RequestOptions;
}) {
  if (!queued && !events.length) return null;
  const latest = events.filter(hasVisibleMessage).findLast(event => event.source === 'agent');
  return (
    <section aria-label="本轮执行" className="mb-3 ml-2 border-l-2 border-slate-200 pl-3">
      {latest && <MessageBubble event={latest} />}
      <ExecutionDetails label="执行详情" events={events.filter(event => event !== latest)} options={options} />
      {queued && <p className="px-2 py-1 text-xs text-slate-600">等待执行</p>}
    </section>
  );
}

function ExecutionDetails({ label, events, options }: {
  label: string; events: ChatEvent[]; options: RequestOptions;
}) {
  if (!events.length) return null;
  const steps = events.filter(event => event.kind === 'ActionEvent').length;
  const plan = getLatestPlan(events);
  return (
    <details className="mb-3 rounded-md border border-slate-200 bg-slate-50">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-700 focus-visible:outline-2 focus-visible:outline-blue-600">
        {label}
        {steps > 0 && <span className="ml-2 font-normal text-slate-500">{steps} 个步骤</span>}
      </summary>
      <div className="max-h-64 overflow-auto border-t border-slate-200 p-3">
        <ChatEventList events={events} requestOptions={options} />
        {plan && <PlanBlock plan={plan.plan} />}
      </div>
    </details>
  );
}
