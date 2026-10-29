import './ProductPlanningChat.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RequestOptions } from '../api';
import { useChatContext } from '../ChatContext';
import { useProductEventStream } from '../hooks/useProductEventStream';
import type { ProductClient } from '../productClient';
import type { ConversationSnapshot, ProductEvent } from '../types';
import type { PlanRevision } from '../experimentPlans';
import { ChatPanel } from './ChatPanel';
import { MessageInput } from './MessageInput';
import { StatusBar } from './StatusBar';
import { ExperimentPlanPanel } from './ExperimentPlanPanel';

export function ProductPlanningChat({ client, title, storageNamespace }: {
  client: ProductClient; title: string; storageNamespace: string;
}) {
  const { state, dispatch } = useChatContext();
  const [userId] = useState(() => new URLSearchParams(window.location.search).get('userId')?.trim() || localStorage.getItem(`${storageNamespace}.userId`) || '42');
  const [credentials, setCredentials] = useState({ cookie: '', xCluster: '' });
  const [credentialDraft, setCredentialDraft] = useState(credentials);
  const options = useMemo<RequestOptions>(() => ({ userId, ...credentials }), [userId, credentials]);
  const [conversations, setConversations] = useState<ConversationSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [afterSeq, setAfterSeq] = useState(0);
  const [hasConnected, setHasConnected] = useState(false);
  const [history, setHistory] = useState<PlanRevision | null>(null);
  const selectedKey = `${storageNamespace}.${userId}.selected`;
  const newKey = `${storageNamespace}.${userId}.new`;
  const activeId = useRef<string | null>(null);
  const generation = useRef(0);
  const refreshTimer = useRef<number | null>(null);
  const decisionIds = useRef(new Map<string, string>());

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

  const open = useCallback(async (id: string) => {
    const epoch = ++generation.current;
    activeId.current = id;
    dispatch({ type: 'SET_CONVERSATION_ID', id });
    setHasConnected(false); setHistory(null); setError(null); setNotice(null); setLoading(true);
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

  const decide = async (accept: boolean) => {
    const id = activeId.current, proposal = state.snapshot?.experiment_plan?.pending_proposal;
    if (!id || !proposal || busy) return;
    setBusy(true); setError(null); setNotice(null);
    const key = `${id}:${proposal.proposal_id}:${accept}`;
    let commandId = decisionIds.current.get(key);
    if (!commandId) { commandId = crypto.randomUUID(); decisionIds.current.set(key, commandId); }
    try {
      const receipt = await client.command(id, {
        type: accept ? 'confirm_experiment_plan' : 'reject_experiment_plan', command_id: commandId,
        proposal_id: proposal.proposal_id, ...(accept ? { expected_revision: proposal.base_revision } : {}),
      }, options);
      setNotice(accept ? `已保存计划版本 ${receipt.response.revision}。` : '已拒绝提案，当前计划保持原版本。');
      await refresh();
    } catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  };

  const newConversation = () => {
    generation.current += 1; activeId.current = null;
    localStorage.removeItem(selectedKey); localStorage.setItem(newKey, '1');
    dispatch({ type: 'RESET_CONVERSATION' });
    setHistory(null); setError(null); setNotice(null); setAfterSeq(0); setHasConnected(false);
  };

  const loadHistory = async (revision: number | null) => {
    if (revision === null) { setHistory(null); return; }
    const id = activeId.current, epoch = generation.current;
    if (!id) return;
    try {
      const saved = await client.revision(id, revision, options);
      if (generation.current === epoch && activeId.current === id) setHistory(saved);
    } catch (failure) { setError(String(failure)); }
  };

  return <div className="product-planning-chat flex h-screen flex-col bg-white text-left text-slate-900">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
      <div><h1 className="font-semibold">{title}</h1><p className="text-xs text-slate-500">实验目标 → 计划草稿 → 确认保存</p></div>
      <div className="flex items-center gap-3 text-sm"><span>用户 {userId}</span><a href="./" className="text-blue-700">Workbench</a><button type="button" onClick={newConversation} disabled={busy || loading || state.status === 'running'} className="rounded border px-3 py-1 disabled:opacity-40">新会话</button></div>
    </header>
    <details className="border-b px-4 py-2 text-xs"><summary>请求配置</summary><form className="mt-2 flex gap-2" onSubmit={event => { event.preventDefault(); setCredentials({ cookie: credentialDraft.cookie.trim(), xCluster: credentialDraft.xCluster.trim() }); }}>
      <label>Cookie<input aria-label="Cookie" type="password" autoComplete="off" value={credentialDraft.cookie} onChange={event => setCredentialDraft(current => ({ ...current, cookie: event.target.value }))} className="ml-2 rounded border p-1" /></label>
      <label>x-cluster<input aria-label="x-cluster" value={credentialDraft.xCluster} onChange={event => setCredentialDraft(current => ({ ...current, xCluster: event.target.value }))} className="ml-2 rounded border p-1" /></label><button type="submit">应用</button>
    </form></details>
    <StatusBar wsState={connection} status={state.status} conversationId={state.conversationId} isCreating={busy && !state.conversationId} hasConnected={hasConnected} />
    {error && <div role="alert" className="border-b bg-red-50 p-3 text-sm text-red-700">{error}<button type="button" className="ml-3 underline" onClick={() => setError(null)}>关闭</button></div>}
    {notice && <div role="status" className="border-b bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
    <main className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[210px_minmax(0,1fr)_440px] lg:overflow-hidden">
      <nav aria-label="会话列表" className="overflow-y-auto border-r bg-slate-50">
        {conversations.map(item => <button key={item.conversation_id} type="button" disabled={busy || loading || state.status === 'running'} onClick={() => { void open(item.conversation_id); }} className={`block w-full border-b p-3 text-left text-sm disabled:opacity-50 ${item.conversation_id === state.conversationId ? 'bg-blue-50' : ''}`}>
          <span className="block truncate">{item.experiment_plan?.current?.plan.name ?? item.conversation_id.slice(0, 12)}</span>
          <span className="text-xs text-slate-500">{item.status} · {item.updated_at ? new Date(item.updated_at).toLocaleString() : '新会话'}</span>
        </button>)}
      </nav>
      <section className="flex min-h-[480px] min-w-0 flex-col lg:min-h-0">
        <ChatPanel events={state.events} requestOptions={options} status={state.status} conversationId={state.conversationId} isCondensing={state.isCondensing} pendingOutboundMessages={state.pendingOutboundMessages} />
        <MessageInput onSend={text => { void send(text); }} status={state.status} sending={busy} disabled={loading || busy} canInterrupt={state.status === 'running' && !busy} onInterrupt={() => {
          const id = activeId.current;
          if (id) void client.command(id, { type: 'cancel', command_id: crypto.randomUUID() }, options).then(() => refresh()).catch(failure => setError(String(failure)));
        }} />
      </section>
      <ExperimentPlanPanel view={state.snapshot?.experiment_plan} selectedRevision={history} busy={busy || loading} onDecision={accept => { void decide(accept); }} onHistory={revision => { void loadHistory(revision); }} onRefresh={() => { void refresh().catch(failure => setError(String(failure))); }} />
    </main>
  </div>;
}
