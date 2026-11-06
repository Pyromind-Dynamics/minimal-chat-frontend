import './ProductPlanningChat.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RequestOptions } from '../api';
import { useChatContext } from '../ChatContext';
import { useProductEventStream } from '../hooks/useProductEventStream';
import type { ProductClient } from '../productClient';
import type { ConversationSnapshot, ProductEvent } from '../types';
import {
  loadRequestOverrides,
  saveRequestOverrides,
  type RequestOverrideFields,
} from '../requestOverrides';
import { ChatPanel } from './ChatPanel';
import { MessageInput } from './MessageInput';
import { StatusBar } from './StatusBar';
import { ExperimentPlanPanel } from './ExperimentPlanPanel';
import { PreparationPanel } from './PreparationPanel';
import { PreparationWelcome } from './PreparationWelcome';
import { PreparationPlanMessage } from './PreparationPlanMessage';
import { StageWorkspace } from './StageWorkspace';
import { ProjectConfirmationPanel } from './ProjectConfirmationPanel';
import { managerChatEvents } from '../preparation';

export function ProductPlanningChat({ client, title, storageNamespace }: {
  client: ProductClient; title: string; storageNamespace: string;
}) {
  const { state, dispatch } = useChatContext();
  const [userId] = useState(() => new URLSearchParams(window.location.search).get('userId')?.trim() || localStorage.getItem(`${storageNamespace}.userId`) || '42');
  const [credentials, setCredentials] = useState<RequestOverrideFields>(loadRequestOverrides);
  const [credentialDraft, setCredentialDraft] = useState<RequestOverrideFields>(credentials);
  const options = useMemo<RequestOptions>(() => ({ userId, cookie: credentials.cookie, xCluster: credentials.xCluster }), [userId, credentials]);
  const [conversations, setConversations] = useState<ConversationSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [afterSeq, setAfterSeq] = useState(0);
  const [hasConnected, setHasConnected] = useState(false);
  const selectedKey = `${storageNamespace}.${userId}.selected`;
  const newKey = `${storageNamespace}.${userId}.new`;
  const activeId = useRef<string | null>(null);
  const generation = useRef(0);
  const refreshTimer = useRef<number | null>(null);
  const createRequest = useRef<{conversation: string; revision: number; command: string} | null>(null);

  const apply = useCallback((snapshot: ConversationSnapshot) => {
    if (activeId.current !== snapshot.conversation_id) return;
    dispatch({ type: 'SET_PRODUCT_SNAPSHOT', snapshot });
    setConversations(current => [snapshot, ...current.filter(item => item.conversation_id !== snapshot.conversation_id)]);
  }, [dispatch]);

  const refresh = useCallback(async () => {
    const id = activeId.current, epoch = generation.current;
    if (!id) return 0;
    const snapshot = await client.snapshot(id, options);
    if (generation.current !== epoch || activeId.current !== id) return 0;
    apply(snapshot);
    return snapshot.through_seq;
  }, [client, options, apply]);

  const readInputMedia = useCallback((requestId: string, contentIndex: number, imageIndex: number) => {
    const id = activeId.current;
    if (!id) return Promise.reject(new Error('会话未打开'));
    return client.inputMedia(id, requestId, contentIndex, imageIndex, options);
  }, [client, options]);

  const open = useCallback(async (id: string) => {
    const epoch = ++generation.current;
    activeId.current = id;
    dispatch({ type: 'SET_CONVERSATION_ID', id });
    setHasConnected(false); setError(null); setNotice(null); setLoading(true);
    try {
      const snapshot = await client.snapshot(id, options);
      if (generation.current !== epoch) return;
      apply(snapshot); setAfterSeq(snapshot.through_seq);
      localStorage.setItem(selectedKey, id); localStorage.removeItem(newKey);
    } catch (failure) {
      if (generation.current === epoch) setError(String(failure));
    } finally { if (generation.current === epoch) setLoading(false); }
  }, [client, options, dispatch, apply, selectedKey, newKey]);

  useEffect(() => {
    let disposed = false;
    localStorage.setItem(`${storageNamespace}.userId`, userId);
    void client.list(options).then(items => {
      if (disposed) return;
      setConversations(items);
      if (localStorage.getItem(newKey)) return;
      const saved = localStorage.getItem(selectedKey);
      const selected = items.find(item => item.conversation_id === saved) ?? items[0];
      if (selected) void open(selected.conversation_id);
    }).catch(failure => { if (!disposed) setError(String(failure)); });
    return () => { disposed = true; };
  }, [client, options, open, storageNamespace, userId, selectedKey, newKey]);

  useEffect(() => () => {
    generation.current += 1;
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
  }, []);

  const onEvent = useCallback((event: ProductEvent) => {
    if (event.conversation_id !== activeId.current) return;
    if (event.type.startsWith('message.')) dispatch({ type: 'APPLY_MESSAGE_EVENTS', events: [event] });
    if (refreshTimer.current === null) refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void refresh().catch(failure => setError(String(failure)));
    }, 120);
  }, [dispatch, refresh]);

  const connection = useProductEventStream({
    conversationId: loading ? null : state.conversationId,
    afterSeq, requestOptions: options, onEvent, onGap: refresh,
    eventsUrl: client.eventsUrl, refreshOnConnect: true,
  });
  useEffect(() => { if (connection === 'open') setHasConnected(true); }, [connection]);
  useEffect(() => {
    const handler = () => { void refresh().catch(failure => setError(String(failure))); };
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, [refresh]);

  const send = async (text: string) => {
    if (busy || loading) return;
    setBusy(true); setError(null); setNotice(null);
    const commandId = crypto.randomUUID();
    dispatch({ type: 'ADD_PENDING_OUTBOUND', message: { commandId, text, status: 'pending' } });
    try {
      let id = activeId.current;
      if (!id) {
        const snapshot = await client.create(options);
        id = snapshot.conversation_id;
        activeId.current = id;
        dispatch({ type: 'SET_CONVERSATION_ID', id });
        dispatch({ type: 'ADD_PENDING_OUTBOUND', message: { commandId, text, status: 'pending' } });
        apply(snapshot); setAfterSeq(snapshot.through_seq); setHasConnected(false);
        localStorage.setItem(selectedKey, id); localStorage.removeItem(newKey);
      }
      await client.command(id, { type: 'user_message', command_id: commandId, content: [{ type: 'text', text }] }, options);
      await refresh();
    } catch (failure) {
      setError(String(failure));
      dispatch({ type: 'MARK_PENDING_OUTBOUND_FAILED', commandId });
    } finally { setBusy(false); }
  };

  const controlExecution = async (runId: string, action: 'cancel' | 'retry_report') => {
    const id = activeId.current; if (!id) return;
    setBusy(true); setError(null);
    try { await client.command(id, {type: 'control_experiment_task', run_id: runId, action, command_id: crypto.randomUUID()}, options); await refresh(); }
    catch (failure) {setError(String(failure));} finally {setBusy(false);}
  };
  const resolveExecution = async (runId: string, action: 'bind' | 'abandon', taskId?: string) => {
    const id = activeId.current; if (!id) return;
    setBusy(true); setError(null);
    try { await client.command(id, {type: 'resolve_experiment_submission', run_id: runId, action, task_id: taskId, command_id: crypto.randomUUID()}, options); await refresh(); }
    catch (failure) {setError(String(failure));} finally {setBusy(false);}
  };

  const newConversation = () => {
    generation.current += 1; activeId.current = null;
    localStorage.removeItem(selectedKey); localStorage.setItem(newKey, '1');
    dispatch({ type: 'RESET_CONVERSATION' });
    setError(null); setNotice(null); setAfterSeq(0); setHasConnected(false);
  };

  const createProject = () => {
    const snapshot = state.snapshot, id = activeId.current;
    if (!snapshot?.preparation || !id || busy) return;
    const revision = snapshot.preparation.revision;
    if (createRequest.current?.conversation !== id || createRequest.current.revision !== revision) createRequest.current = {conversation: id, revision, command: crypto.randomUUID()};
    const commandId = createRequest.current.command;
    setBusy(true); setError(null);
    void client.command(id, {type: 'create_project', command_id: commandId, expected_preparation_revision: revision}, options)
      .then(() => refresh()).catch(failure => { setError(String(failure)); void refresh(); }).finally(() => setBusy(false));
  };

  const respondToInput = async (requestId: string, status: 'answered' | 'cancelled', answers: import('../types').UserInputAnswer[], commandId: string) => {
    const id = activeId.current; if (!id) throw new Error('会话未打开');
    await client.command(id, {type: 'input_response', command_id: commandId, request_id: requestId, status, answers}, options);
    await refresh();
  };

  const applyCredentials = () => {
    const next = {
      cookie: credentialDraft.cookie.trim(),
      xCluster: credentialDraft.xCluster.trim(),
    };
    setCredentials(next);
    setCredentialDraft(next);
    saveRequestOverrides(next);
  };


  return <div className="product-planning-chat flex h-screen flex-col bg-white text-left text-slate-900">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
      <div><h1 className="font-semibold">{title}</h1><p className="text-xs text-slate-500">对话准备 → 审阅 workflowPLAN → 创建并启动 → 阶段工作台</p></div>
      <div className="flex items-center gap-3 text-sm"><span>用户 {userId}</span><a href="./" className="text-blue-700">Workbench</a><button type="button" onClick={newConversation} disabled={busy || loading} className="rounded border px-3 py-1 disabled:opacity-40">新会话</button></div>
    </header>
    <details className="shrink-0 border-b bg-slate-50 px-4 py-2 text-xs text-slate-500">
      <summary className="cursor-pointer">连接设置 · 用户 {userId}{credentials.xCluster ? ` · ${credentials.xCluster}` : ''}</summary>
    <form
      className="mt-3 grid gap-2 sm:grid-cols-[minmax(220px,1fr)_minmax(160px,220px)_auto]"
      onSubmit={event => {
        event.preventDefault();
        applyCredentials();
      }}
    >
      <label className="min-w-0">
        <span className="mb-1 block text-xs font-medium text-gray-500">Cookie</span>
        <input
          aria-label="Cookie"
          name="cookie"
          type="password"
          value={credentialDraft.cookie}
          onChange={event => setCredentialDraft(current => ({ ...current, cookie: event.target.value }))}
          placeholder="name=value; other=value"
          spellCheck={false}
          autoCapitalize="off"
          className="w-full rounded-md border border-gray-200 px-3 py-1.5 font-mono text-xs outline-none focus:border-blue-500"
        />
      </label>
      <label className="min-w-0">
        <span className="mb-1 block text-xs font-medium text-gray-500">x-cluster</span>
        <input
          aria-label="x-cluster"
          name="x-cluster"
          value={credentialDraft.xCluster}
          onChange={event => setCredentialDraft(current => ({ ...current, xCluster: event.target.value }))}
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
    </details>
    <StatusBar wsState={connection} status={state.status} conversationId={state.conversationId} isCreating={busy && !state.conversationId} hasConnected={hasConnected} />
    {error && <div role="alert" className="border-b bg-red-50 p-3 text-sm text-red-700">{error}<button type="button" className="ml-3 underline" onClick={() => setError(null)}>关闭</button></div>}
    {notice && <div role="status" className="border-b bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
    <main className={`grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:overflow-hidden ${state.snapshot?.project ? 'project-workbench lg:grid-cols-[200px_minmax(0,1fr)_360px] 2xl:grid-cols-[220px_minmax(0,1fr)_420px]' : !state.snapshot || state.snapshot.preparation ? 'lg:grid-cols-[220px_minmax(0,1fr)]' : 'lg:grid-cols-[200px_minmax(0,1fr)_520px] 2xl:grid-cols-[240px_minmax(0,1fr)_600px]'}`}>
      <nav aria-label="会话列表" className="overflow-y-auto border-r bg-slate-50">
        <div className="border-b p-3 text-xs font-medium text-slate-500">对话与 Project <span className="ml-1 text-slate-400">{conversations.length}</span></div>
        {conversations.map(item => <button key={item.conversation_id} type="button" disabled={busy || loading} onClick={() => { void open(item.conversation_id); }} className={`block w-full border-b p-3 text-left text-sm disabled:opacity-50 ${item.conversation_id === state.conversationId ? 'bg-blue-50' : ''}`}>
          <span className="block truncate">{item.preparation?.plan?.goal || item.experiment_context?.context.goal || item.experiment_plan?.current?.plan.name || item.conversation_id.slice(0, 12)}</span>
          <span className="mt-1 block text-[11px] text-slate-500">{item.project ? 'Project' : item.preparation ? '准备中' : '历史会话'} · {item.updated_at ? new Date(item.updated_at).toLocaleString() : '新会话'}</span>
        </button>)}
      </nav>
      <section className="flex min-h-[480px] min-w-0 flex-col lg:min-h-0">
        {state.snapshot?.project && <StageWorkspace snapshot={state.snapshot} requestOptions={options} />}
        <section aria-label="聊天区" className="flex min-h-0 flex-1 flex-col bg-white">
        {state.snapshot?.project && <header className="flex shrink-0 items-center gap-3 border-b bg-white px-4 py-3">
          <span className="rounded bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-800">Chat</span><h2 className="font-semibold">Manager 对话</h2>
        </header>}
        {!state.conversationId && state.pendingOutboundMessages.length === 0 ? <PreparationWelcome /> : <ChatPanel events={state.snapshot?.project ? managerChatEvents(state.events) : state.events} requestOptions={options} status={state.status} conversationId={state.conversationId} isCondensing={state.isCondensing} pendingOutboundMessages={state.pendingOutboundMessages}
          contentKey={state.snapshot?.preparation?.plan ? state.snapshot.preparation.revision : undefined}
          pendingInputs={state.snapshot?.project ? [] : state.snapshot?.pending_inputs ?? []}
          onRespondToUserInput={respondToInput} readInputMedia={readInputMedia}>
          {state.snapshot?.preparation?.plan && !state.snapshot.project && <PreparationPlanMessage snapshot={state.snapshot} busy={busy || loading} onCreate={createProject} />}
        </ChatPanel>}
        {state.snapshot?.preparation && <PreparationPanel snapshot={state.snapshot} />}
        <MessageInput onSend={text => { void send(text); }} status={state.status} sending={busy} disabled={loading || busy} canInterrupt={state.status === 'running' && !busy} onInterrupt={() => {
          const id = activeId.current;
          if (id) void client.command(id, { type: 'cancel', command_id: crypto.randomUUID() }, options).then(() => refresh()).catch(failure => setError(String(failure)));
        }} />
        </section>
      </section>
      {state.snapshot?.project && <ProjectConfirmationPanel snapshot={state.snapshot} onRespond={respondToInput}
        onPermission={async (permissionId, decision, commandId) => {
          const id = activeId.current; if (!id) throw new Error('会话未打开');
          await client.command(id, {type: 'permission_response', command_id: commandId, permission_id: permissionId, decision}, options);
          await refresh();
        }}
        readMedia={readInputMedia} />}
      {state.snapshot && !state.snapshot.preparation && !state.snapshot.project && <ExperimentPlanPanel view={state.snapshot.experiment_plan} contextView={state.snapshot.experiment_context} exploration
        executions={state.snapshot?.experiment_executions ?? []} selectedRevision={null} busy={busy || loading}
        queue={state.snapshot?.experiment_queue ?? []}
        onDecision={() => {}} onHistory={() => {}}
        onRefresh={() => { void refresh().catch(failure => setError(String(failure))); }}
        onControl={controlExecution}
        onReadArtifact={async (runId, name) => {
          const id = activeId.current; if (!id) throw new Error('会话未打开');
          return client.executionArtifact(id, runId, name, options);
        }}
        onResolve={resolveExecution} />}
    </main>
  </div>;
}
