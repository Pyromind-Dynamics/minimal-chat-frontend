import './ProductPlanningChat.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RequestOptions } from '../api';
import { useChatContext } from '../ChatContext';
import { useProductEventStream } from '../hooks/useProductEventStream';
import type { ProductClient } from '../productClient';
import type { ConversationSnapshot, ProductEvent } from '../types';
import type { ProjectSummary } from '../echomindContract';
import { resolveEchoMindSelection } from '../echomindNavigation';
import {
  loadRequestOverrides,
  saveRequestOverrides,
  type RequestOverrideFields,
} from '../requestOverrides';
import { ChatPanel } from './ChatPanel';
import { MessageInput } from './MessageInput';
import { StatusBar } from './StatusBar';
import { PreparationPanel } from './PreparationPanel';
import { PreparationWelcome } from './PreparationWelcome';
import { PreparationPlanMessage } from './PreparationPlanMessage';
import { StageWorkspace } from './StageWorkspace';
import { ProjectConfirmationPanel } from './ProjectConfirmationPanel';
import { managerChatEvents } from '../preparation';

function updateWorkbenchUrl(projectId: string | null, conversationId: string | null) {
  const url = new URL(window.location.href);
  if (projectId) url.searchParams.set('project', projectId);
  else url.searchParams.delete('project');
  if (conversationId) url.searchParams.set('conversation', conversationId);
  else url.searchParams.delete('conversation');
  window.history.replaceState(null, '', url);
}

export function ProductPlanningChat({ client, title, storageNamespace }: {
  client: ProductClient; title: string; storageNamespace: string;
}) {
  const { state, dispatch } = useChatContext();
  const [userId] = useState(() => new URLSearchParams(window.location.search).get('userId')?.trim() || localStorage.getItem(`${storageNamespace}.userId`) || '42');
  const [credentials, setCredentials] = useState<RequestOverrideFields>(loadRequestOverrides);
  const [credentialDraft, setCredentialDraft] = useState<RequestOverrideFields>(credentials);
  const options = useMemo<RequestOptions>(() => ({ userId, cookie: credentials.cookie, xCluster: credentials.xCluster }), [userId, credentials]);
  const [conversations, setConversations] = useState<ConversationSnapshot[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<'conversations' | 'projects'>('projects');
  const [busy, setBusy] = useState(false);
  const [respondingPermission, setRespondingPermission] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [afterSeq, setAfterSeq] = useState(0);
  const [hasConnected, setHasConnected] = useState(false);
  const selectedKey = `${storageNamespace}.${userId}.selected`;
  const selectedProjectKey = `${storageNamespace}.${userId}.project`;
  const newKey = `${storageNamespace}.${userId}.new`;
  const activeId = useRef<string | null>(null);
  const didRestore = useRef(false);
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

  const refreshProjects = useCallback(async () => {
    const items = await client.listProjects(options);
    setProjects(items);
    return items;
  }, [client, options]);

  const readInputMedia = useCallback((requestId: string, contentIndex: number, imageIndex: number) => {
    const id = activeId.current;
    if (!id) return Promise.reject(new Error('会话未打开'));
    return client.inputMedia(id, requestId, contentIndex, imageIndex, options);
  }, [client, options]);

  const open = useCallback(async (id: string, clusterOverride?: string) => {
    const epoch = ++generation.current;
    activeId.current = id;
    dispatch({ type: 'SET_CONVERSATION_ID', id });
    setHasConnected(false); setError(null); setNotice(null); setLoading(true);
    const requestOptions = clusterOverride
      ? { ...options, xCluster: clusterOverride }
      : options;
    try {
      const snapshot = await client.snapshot(id, requestOptions);
      if (generation.current !== epoch) return;
      apply(snapshot); setAfterSeq(snapshot.through_seq);
      localStorage.setItem(selectedKey, id); localStorage.removeItem(newKey);
    } catch (failure) {
      if (generation.current === epoch) setError(String(failure));
    } finally { if (generation.current === epoch) setLoading(false); }
  }, [client, options, dispatch, apply, selectedKey, newKey]);

  const openProject = useCallback((project: ProjectSummary) => {
    const nextCredentials = { ...credentials, xCluster: project.cluster };
    setCredentials(nextCredentials);
    setCredentialDraft(nextCredentials);
    saveRequestOverrides(nextCredentials);
    setActiveProjectId(project.project_id);
    localStorage.setItem(selectedProjectKey, project.project_id);
    updateWorkbenchUrl(project.project_id, project.conversation_id);
    void open(project.conversation_id, project.cluster);
  }, [credentials, open, selectedProjectKey]);

  const openConversation = useCallback((
    conversationId: string,
    projectId?: string | null,
    cluster?: string | null,
  ) => {
    if (cluster) {
      const nextCredentials = { ...credentials, xCluster: cluster };
      setCredentials(nextCredentials);
      setCredentialDraft(nextCredentials);
      saveRequestOverrides(nextCredentials);
    }
    setActiveProjectId(projectId ?? null);
    if (projectId) localStorage.setItem(selectedProjectKey, projectId);
    else localStorage.removeItem(selectedProjectKey);
    updateWorkbenchUrl(projectId ?? null, conversationId);
    void open(conversationId, cluster ?? undefined);
  }, [credentials, open, selectedProjectKey]);

  useEffect(() => {
    let disposed = false;
    localStorage.setItem(`${storageNamespace}.userId`, userId);
    if (didRestore.current) return () => { disposed = true; };
    void Promise.allSettled([
      client.list(options),
      client.listProjects(options),
    ]).then(([conversationResult, projectResult]) => {
      if (disposed) return;
      if (conversationResult.status === 'rejected') {
        setError(String(conversationResult.reason));
        return;
      }
      const items = conversationResult.value;
      const projectItems = projectResult.status === 'fulfilled'
        ? projectResult.value
        : [];
      setConversations(items);
      setProjects(projectItems);
      if (projectResult.status === 'rejected') {
        setError(String(projectResult.reason));
      }
      if (localStorage.getItem(newKey)) {
        didRestore.current = true;
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const selection = resolveEchoMindSelection({
        urlProjectId: params.get('project'),
        savedProjectId: localStorage.getItem(selectedProjectKey),
        urlConversationId: params.get('conversation'),
        savedConversationId: localStorage.getItem(selectedKey),
        projects: projectItems,
        conversations: items,
      });
      didRestore.current = true;
      if (selection?.project) {
        openProject(selection.project);
      } else if (selection) {
        updateWorkbenchUrl(null, selection.conversationId);
        void open(selection.conversationId);
      }
    }).catch(failure => { if (!disposed) setError(String(failure)); });
    return () => { disposed = true; };
  }, [
    client,
    options,
    open,
    openProject,
    storageNamespace,
    userId,
    selectedKey,
    selectedProjectKey,
    newKey,
  ]);

  useEffect(() => () => {
    generation.current += 1;
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
  }, []);

  const onEvent = useCallback((event: ProductEvent) => {
    if (event.conversation_id !== activeId.current) return;
    if (event.type.startsWith('message.')) dispatch({ type: 'APPLY_MESSAGE_EVENTS', events: [event] });
    if (event.type === 'project.changed') {
      void refreshProjects().catch(failure => setError(String(failure)));
    }
    if (refreshTimer.current === null) refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void refresh().catch(failure => setError(String(failure)));
    }, 120);
  }, [dispatch, refresh, refreshProjects]);

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
        updateWorkbenchUrl(null, id);
      }
      await client.command(id, { type: 'user_message', command_id: commandId, content: [{ type: 'text', text }] }, options);
      await refresh();
    } catch (failure) {
      setError(String(failure));
      dispatch({ type: 'MARK_PENDING_OUTBOUND_FAILED', commandId });
    } finally { setBusy(false); }
  };

  const respondToPermission = async (accept: boolean) => {
    const id = activeId.current;
    const permission = state.snapshot?.pending_permissions[0];
    if (!id || !permission || respondingPermission) return;
    setRespondingPermission(true); setError(null);
    try {
      const receipt = await client.command(id, {
        command_id: crypto.randomUUID(),
        type: 'permission_response',
        permission_id: permission.permission_id,
        decision: accept ? 'allow_once' : 'deny',
        reason: accept ? undefined : 'User rejected the pending action.',
      }, options);
      if (receipt.status === 'failed') throw new Error(JSON.stringify(receipt.response));
      await refresh();
    } catch (failure) {
      setError(String(failure));
      await refresh().catch(() => undefined);
    } finally {
      setRespondingPermission(false);
    }
  };

  const newConversation = () => {
    generation.current += 1; activeId.current = null;
    localStorage.removeItem(selectedKey);
    localStorage.removeItem(selectedProjectKey);
    localStorage.setItem(newKey, '1');
    setActiveProjectId(null);
    updateWorkbenchUrl(null, null);
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
      .then(async () => {
        await refresh();
        const items = await refreshProjects();
        const current = items.find(item => item.conversation_id === id);
        if (current) {
          setActiveProjectId(current.project_id);
          localStorage.setItem(selectedProjectKey, current.project_id);
          updateWorkbenchUrl(current.project_id, current.conversation_id);
        }
      }).catch(failure => { setError(String(failure)); void refresh(); }).finally(() => setBusy(false));
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


  const isProject = Boolean(state.snapshot?.project);
  const currentProjectId = activeProjectId ?? state.snapshot?.project?.project_id ?? null;

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
    <main className={`grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:overflow-hidden ${isProject ? 'project-workbench lg:grid-cols-[320px_minmax(0,1fr)_360px] 2xl:grid-cols-[340px_minmax(0,1fr)_420px]' : 'lg:grid-cols-[320px_minmax(0,1fr)]'}`}>
      <nav aria-label="EchoMind 导航" className="min-h-0 overflow-hidden border-r bg-slate-50 lg:grid lg:grid-cols-2">
        <div className="flex border-b p-2 lg:hidden">
          <button type="button" onClick={() => setMobilePane('projects')} className={`flex-1 rounded px-3 py-1.5 text-sm ${mobilePane === 'projects' ? 'bg-white font-medium shadow-sm' : 'text-slate-500'}`}>Project</button>
          <button type="button" onClick={() => setMobilePane('conversations')} className={`flex-1 rounded px-3 py-1.5 text-sm ${mobilePane === 'conversations' ? 'bg-white font-medium shadow-sm' : 'text-slate-500'}`}>对话</button>
        </div>
        <section className={`${mobilePane === 'projects' ? 'block' : 'hidden'} min-h-0 overflow-y-auto lg:block lg:border-r`}>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
            <span>Project</span><span className="text-slate-400">{projects.length}</span>
          </div>
          {projects.length === 0 && <p className="p-3 text-xs text-slate-400">暂无 Project</p>}
          {projects.map(project => <button key={project.project_id} type="button" disabled={busy || loading} onClick={() => openProject(project)} className={`block w-full border-b p-3 text-left text-sm disabled:opacity-50 ${project.project_id === currentProjectId ? 'bg-blue-50' : 'hover:bg-white'}`}>
            <span className="block truncate font-medium">{project.name}</span>
            <span className="mt-1 block truncate font-mono text-[10px] text-slate-500">{project.cluster}</span>
            <span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-500">
              <span>{project.lifecycle === 'development' ? '开发中' : '已发布'} · {project.node_count} 节点</span>
              <time className="shrink-0">{new Date(project.updated_at).toLocaleDateString()}</time>
            </span>
          </button>)}
        </section>
        <section className={`${mobilePane === 'conversations' ? 'block' : 'hidden'} min-h-0 overflow-y-auto lg:block`}>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
            <span>对话</span><span className="text-slate-400">{conversations.length}</span>
          </div>
          {conversations.length === 0 && <p className="p-3 text-xs text-slate-400">暂无对话</p>}
          {conversations.map(item => <button key={item.conversation_id} type="button" disabled={busy || loading} onClick={() => openConversation(item.conversation_id, item.project?.project_id, item.project?.cluster)} className={`block w-full border-b p-3 text-left text-sm disabled:opacity-50 ${item.conversation_id === state.conversationId ? 'bg-blue-50' : 'hover:bg-white'}`}>
            <span className="block truncate">{item.project?.plan.goal || item.preparation?.plan?.goal || item.conversation_id.slice(0, 12)}</span>
            <span className="mt-1 block text-[11px] text-slate-500">{item.project ? 'Project · 开发中' : '准备中'} · {item.updated_at ? new Date(item.updated_at).toLocaleString() : '新会话'}</span>
          </button>)}
        </section>
      </nav>
      <section className="flex min-h-[480px] min-w-0 flex-col lg:min-h-0">
        {state.snapshot?.project && <StageWorkspace snapshot={state.snapshot} requestOptions={options} />}
        <section aria-label="聊天区" className="flex min-h-0 flex-1 flex-col bg-white">
        {state.snapshot?.project && <header className="flex shrink-0 items-center gap-3 border-b bg-white px-4 py-3">
          <span className="rounded bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-800">Chat</span><h2 className="font-semibold">Manager 对话</h2>
        </header>}
        {!state.conversationId && state.pendingOutboundMessages.length === 0 ? <PreparationWelcome /> : <ChatPanel events={state.snapshot?.project ? managerChatEvents(state.events) : state.events} requestOptions={options} status={state.status} conversationId={state.conversationId} isCondensing={state.isCondensing} pendingOutboundMessages={state.pendingOutboundMessages}
          contentKey={state.snapshot?.preparation?.plan ? state.snapshot.preparation.revision : undefined}
          pendingInputs={isProject ? undefined : state.snapshot?.pending_inputs}
          pendingPermission={isProject ? undefined : state.snapshot?.pending_permissions[0]}
          isRespondingToConfirmation={respondingPermission}
          onRespondToConfirmation={isProject ? undefined : accept => { void respondToPermission(accept); }}
          onRespondToUserInput={isProject ? undefined : async (requestId, status, answers, commandId) => {
            const id = activeId.current; if (!id) return;
            await client.command(id, {type: 'input_response', command_id: commandId, request_id: requestId, status, answers}, options);
            await refresh();
          }}>
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
    </main>
  </div>;
}
