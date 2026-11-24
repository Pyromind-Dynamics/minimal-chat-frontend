import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import type { RequestOptions } from '../api';
import { ChatProvider, useChatContext } from '../ChatContext';
import { useProductEventStream } from '../hooks/useProductEventStream';
import type { EchoMindChatClient } from '../productClient';
import { type ChatEvent, type ConversationSnapshot, type ProductEvent } from '../types';
import { ChatEventList, ChatPanel } from './ChatPanel';
import { groupEchoMindTurns, type EchoMindTurn } from '../echomindConversationPresentation';
import { preparationPlanStatus } from '../preparation';
import { MessageInput } from './MessageInput';
import { PreparationWelcome } from './PreparationWelcome';
import { ExecutionDetails } from './ExecutionDetails';

interface AgentChatProps {
  client: EchoMindChatClient;
  managerId: string | null;
  ensureManager: () => Promise<string>;
  options: RequestOptions;
  disabled: boolean;
  executionEvents: ChatEvent[];
  executionSnapshot: ConversationSnapshot | null;
  executionIsCondensing: boolean;
  onOpenConfirmation: (targetId?: string) => void;
  onOpenPlan: () => void;
  onOpenExecution: () => void;
  panel: Pick<ComponentProps<typeof ChatPanel>,
    'children' | 'contentKey' | 'pendingPermission' | 'pendingInputs' | 'isRespondingToConfirmation'
    | 'onRespondToConfirmation' | 'onRespondToUserInput' | 'readInputMedia'>;
}

export function EchoMindAgentChat(props: AgentChatProps) {
  return <ChatProvider><AgentChat {...props} /></ChatProvider>;
}

function AgentChat({
  client, managerId, ensureManager, options, disabled,
  executionEvents, executionSnapshot, executionIsCondensing, onOpenConfirmation, onOpenPlan, onOpenExecution, panel,
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
  const turnElements = useRef(new Map<string, HTMLElement>());
  const turnIds = new Set(groups.turns.map(turn => turn.id));
  const planStatus = preparationPlanStatus(executionSnapshot);
  const timeline = groups.entries.length || groups.background.length ? <>
    {groups.entries.map(entry => {
      if (entry.kind === 'notice') {
        const link = entry.message.execution_notice;
        const origin = link?.origin_turn_id;
        const target = link?.target_id;
        const version = entry.reports?.[0]?.version;
        const message = { ...entry.message };
        if (link?.action === 'report') {
          const english = message.llm_message.content.some(b => b.type === 'text' && /\breport\b/i.test(b.text));
          let text = english ? 'The report is ready.' : '报告已生成。';
          if (version && version > 1) text = english ? `Report updated to version ${version}.`
            : `报告已更新，最新为第 ${version} 版。`;
          message.llm_message = { ...message.llm_message, content: [{ type: 'text', text }] };
        }
        const currentPlan = link?.action === 'plan' && planStatus === 'ready'
          && String(executionSnapshot?.preparation?.revision) === target;
        const pending = link?.action === 'confirmation' && (
          executionSnapshot?.pending_inputs?.some(item => item.request_id === target)
          || executionSnapshot?.pending_permissions.some(item => item.permission_id === target)
        );
        return <div key={entry.message.id} className="mb-5">
          {entry.receiptStatuses.length > 0 && <p className="mb-1 pl-2 text-xs text-slate-600">
            {entry.receiptStatuses.join('、')}。以下为提交时的回执。
          </p>}
          <ChatEventList events={[message]} requestOptions={options} />
          <div className="flex flex-wrap gap-3 pl-2 text-xs font-medium text-violet-700">
            {currentPlan && <button type="button" className="underline" onClick={onOpenPlan}>查看工作流计划</button>}
            {pending && <button type="button" className="underline" onClick={() => onOpenConfirmation(target)}>查看待确认事项</button>}
            {origin && turnIds.has(origin) && <button type="button" className="underline" onClick={() => {
              const element = turnElements.current.get(origin);
              element?.scrollIntoView({ block: 'start' });
              element?.focus({ preventScroll: true });
            }}>查看原任务</button>}
            {(!origin || !turnIds.has(origin)) && executionSnapshot?.project && !pending
              && <button type="button" className="underline" onClick={onOpenExecution}>查看执行阶段</button>}
          </div>
        </div>;
      }
      const turn = entry.turn;
      const first = turn && entry.messages[0] === turn.messages[0];
      if (!first) return <ChatEventList key={entry.id} events={entry.messages} requestOptions={options} />;
      return <article key={entry.id} tabIndex={-1} className="mb-5 last:mb-0" ref={element => {
        if (element) turnElements.current.set(turn.id, element);
        else turnElements.current.delete(turn.id);
      }}>
        <ChatEventList events={entry.messages} requestOptions={options} />
        <TurnExecution turn={turn} options={options} onOpenConfirmation={() => onOpenConfirmation()} />
      </article>;
    })}
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
    {executionSnapshot && <ExecutionActions
      snapshot={executionSnapshot} onOpenPlan={onOpenPlan} onOpenConfirmation={() => onOpenConfirmation()} />}
    <MessageInput
      runningMode="send" interruptLabel="停止回复"
      onSend={text => { void send(text); }} status={state.status} sending={busy}
      disabled={disabled || busy} canInterrupt={state.status === 'running' && !busy}
      onInterrupt={() => { void interrupt(); }} />
  </section>;
}

function ExecutionActions({ snapshot, onOpenPlan, onOpenConfirmation }: {
  snapshot: ConversationSnapshot;
  onOpenPlan: () => void; onOpenConfirmation: () => void;
}) {
  const pending = (snapshot.pending_inputs?.length ?? 0) + snapshot.pending_permissions.length;
  const planStatus = preparationPlanStatus(snapshot);
  const planLabel = planStatus === 'ready' ? '工作流计划待确认' : planStatus === 'review_required' ? '工作流计划需要重新核对' : null;
  if (!pending && !planLabel) return null;
  return <aside aria-label="任务提醒" className="shrink-0 space-y-1 border-t bg-slate-50 px-4 py-2 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2 text-amber-900">
      <span role="status">{pending ? `有 ${pending} 项待处理，执行需要你的回复` : planLabel}</span>
      <button type="button" onClick={pending ? onOpenConfirmation : onOpenPlan} className="font-medium underline">
        {pending ? '查看待确认事项' : '查看工作流计划'}
      </button>
    </div>
  </aside>;
}

function TurnExecution({ turn, options, onOpenConfirmation }: {
  turn: EchoMindTurn; options: RequestOptions; onOpenConfirmation: () => void;
}) {
  const { execution: events, progress, needsConfirmation } = turn;
  if (!progress.length && !events.length && !needsConfirmation) return null;
  const primary = progress.find(item => item.needsAttention)
    ?? progress.find(item => !item.settled) ?? progress.at(-1);
  const title = primary?.stage ?? primary?.title;
  const taskDetails = progress.filter(item => item !== primary || item.stage || item.attempts?.length);
  const summary = primary && <span className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap" aria-live="polite">
    <span className="min-w-0 truncate font-medium" title={title}>{title}</span>
    <span aria-hidden="true" className="shrink-0 text-slate-400">·</span>
    <span title={primary.status} className={`min-w-0 truncate ${primary.needsAttention ? 'font-medium text-amber-800' : 'text-slate-600'}`}>
      {primary.status}
    </span>
    {progress.length > 1 && <span className="ml-auto shrink-0 text-slate-500">{progress.length} 项</span>}
  </span>;
  return (
    <section aria-label="本轮执行" className="mb-3 ml-2 border-l-2 border-slate-200 pl-3">
      {(primary || needsConfirmation) && <div role="group" aria-label="本轮进度">
        {primary && (events.length > 0 || taskDetails.length > 0) ? (
          <ExecutionDetails summary={summary} events={events} options={options}>
            {taskDetails.length > 0 && <ul className="mb-2 space-y-2 text-xs text-slate-700">
              {taskDetails.map(item => <li key={item.id} className="break-words border-b border-slate-200 pb-2">
                <span className="font-medium">{item.stage && `${item.stage} · `}{item.title}</span>
                <span className="ml-2 text-slate-600">{item.status}</span>
                {item.attempts && <ol aria-label="重试记录" className="mt-1 space-y-1 pl-3 text-slate-600">
                  {item.attempts.map((attempt, index) => <li key={attempt.id}>
                    第 {index + 1} 次 · {attempt.status}{attempt.reason && ` · ${attempt.reason}`}
                  </li>)}
                </ol>}
              </li>)}
            </ul>}
          </ExecutionDetails>
        ) : primary && <div className="mb-3 flex min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">{summary}</div>}
        {progress.map(item => {
          if (item.reason) return <p key={item.id} className="mb-2 break-words text-xs text-amber-800">
            {item !== primary && <span className="font-medium">{item.title} · {item.status} · </span>}{item.reason}
          </p>;
          if (item === primary || (!item.needsAttention && !item.reportReady)) return null;
          return <p key={item.id} className={`mb-2 break-words text-xs ${item.needsAttention ? 'text-amber-800' : 'text-slate-700'}`}>
            {item.title} · {item.status}
          </p>;
        })}
        {needsConfirmation && <button type="button" onClick={onOpenConfirmation} className="mb-2 text-xs font-medium text-violet-700 underline">查看待确认事项</button>}
      </div>}
      {!primary && <ExecutionDetails label="执行详情" events={events} options={options} />}
    </section>
  );
}
