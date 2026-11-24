import './ProductPlanningChat.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RequestOptions } from '../api';
import { useChatContext } from '../ChatContext';
import { useProductEventStream } from '../hooks/useProductEventStream';
import type { EchoMindChatClient, ProductClient } from '../productClient';
import type { ConversationSnapshot, ConversationSummary, ProductEvent } from '../types';
import type { ProjectSummary } from '../echomindContract';
import { resolveEchoMindSelection } from '../echomindNavigation';
import {
  loadRequestOverrides,
  saveRequestOverrides,
  type RequestOverrideFields,
} from '../requestOverrides';
import { PreparationWelcome } from './PreparationWelcome';
import { ChatPanel } from './ChatPanel';
import { visibleExecutionEvents } from '../echomindConversationPresentation';
import { EchoMindAgentChat } from './EchoMindAgentChat';
import { deriveDisplayConnectionState } from '../productStreamState';
import { PreparationPlanMessage } from './PreparationPlanMessage';
import { StageWorkspace } from './StageWorkspace';
import { ProjectOverview } from './observations/ProjectOverview';
import { ProjectConfirmationPanel } from './ProjectConfirmationPanel';
import { managerChatEvents, preparationPlanStatus } from '../preparation';

function updateWorkbenchUrl(projectId: string | null, conversationId: string | null) {
  const url = new URL(window.location.href);
  if (projectId) url.searchParams.set('project', projectId);
  else url.searchParams.delete('project');
  if (conversationId) url.searchParams.set('conversation', conversationId);
  else url.searchParams.delete('conversation');
  window.history.replaceState(null, '', url);
}

export function ProductPlanningChat({ client, chatClient, title, storageNamespace }: {
  client: ProductClient; chatClient: EchoMindChatClient; title: string; storageNamespace: string;
}) {
  const { state, dispatch } = useChatContext();
  const [userId] = useState(() => new URLSearchParams(window.location.search).get('userId')?.trim() || localStorage.getItem(`${storageNamespace}.userId`) || '42');
  const [credentials, setCredentials] = useState<RequestOverrideFields>(loadRequestOverrides);
  const [credentialDraft, setCredentialDraft] = useState<RequestOverrideFields>(credentials);
  const projectCluster = state.snapshot?.project?.cluster;
  const options = useMemo<RequestOptions>(() => ({
    userId, cookie: credentials.cookie, xCluster: projectCluster ?? credentials.xCluster,
  }), [userId, credentials, projectCluster]);
  const navigationOptions = useMemo<RequestOptions>(() => ({
    userId, cookie: credentials.cookie, xCluster: credentials.xCluster,
  }), [userId, credentials]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [mobilePane, setMobilePane] = useState<'conversations' | 'projects'>('projects');
  const [busy, setBusy] = useState(false);
  const [respondingPermission, setRespondingPermission] = useState(false);
  const [loading, setLoading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
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
  const request = useRef<AbortController | null>(null);
  const target = useRef<{ conversationId?: string; projectId?: string; cluster?: string } | null>(null);
  const refreshTimer = useRef<number | null>(null);
  const inFlight = useRef<Promise<number> | null>(null);
  const refreshAgain = useRef(false);
  const lastRefresh = useRef(0);
  const createRequest = useRef<{conversation: string; revision: number; command: string} | null>(null);
  const reviewRequest = useRef<{conversation: string; revision: number; command: string} | null>(null);

  const apply = useCallback((snapshot: ConversationSnapshot) => {
    if (activeId.current !== snapshot.conversation_id) return;
    dispatch({ type: 'SET_PRODUCT_SNAPSHOT', snapshot });
    const summary: ConversationSummary = {
      conversation_id: snapshot.conversation_id,
      status: snapshot.status,
      through_seq: snapshot.through_seq,
      updated_at: snapshot.updated_at ?? null,
      title: snapshot.project?.plan.goal ?? snapshot.preparation?.plan?.goal ?? null,
      project_id: snapshot.project?.project_id ?? null,
      cluster: snapshot.project?.cluster ?? null,
    };
    setConversations(current => {
      const existing = current.find(item => item.conversation_id === summary.conversation_id);
      if (existing && existing.through_seq > summary.through_seq) return current;
      return [{ ...summary, title: summary.title ?? existing?.title ?? null },
        ...current.filter(item => item.conversation_id !== summary.conversation_id)];
    });
  }, [dispatch]);

  const resetRequests = useCallback(() => {
    generation.current += 1;
    request.current?.abort();
    request.current = null;
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = null;
    inFlight.current = null;
    refreshAgain.current = false;
    lastRefresh.current = 0;
  }, []);

  const refresh = useCallback(async function refresh(): Promise<number> {
    const id = activeId.current, epoch = generation.current;
    if (!id || loading || openError) return 0;
    if (inFlight.current) {
      refreshAgain.current = true;
      return inFlight.current;
    }
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = null;
    refreshAgain.current = false;
    lastRefresh.current = performance.now();
    const signal = request.current?.signal;
    const pending = client.snapshot(id, options, signal).then(snapshot => {
      if (generation.current !== epoch) return 0;
      apply(snapshot);
      return snapshot.through_seq;
    }).catch(failure => {
      if (generation.current !== epoch) return 0;
      throw failure;
    }).finally(() => {
      if (generation.current !== epoch) return;
      inFlight.current = null;
      if (refreshAgain.current && refreshTimer.current === null) {
        refreshAgain.current = false;
        refreshTimer.current = window.setTimeout(() => {
          refreshTimer.current = null;
          void refresh().catch(failure => setError(String(failure)));
        }, Math.max(0, 300 - (performance.now() - lastRefresh.current)));
      }
    });
    inFlight.current = pending;
    return pending;
  }, [apply, client, loading, openError, options]);

  const refreshProjects = useCallback(async () => {
    const items = await client.listProjects(navigationOptions);
    setProjects(items);
    return items;
  }, [client, navigationOptions]);

  const readInputMedia = useCallback((requestId: string, contentIndex: number, imageIndex: number) => {
    const id = activeId.current;
    if (!id) return Promise.reject(new Error('会话未打开'));
    return client.inputMedia(id, requestId, contentIndex, imageIndex, options);
  }, [client, options]);

  const open = useCallback(async (selection: NonNullable<typeof target.current>) => {
    resetRequests();
    const controller = new AbortController();
    request.current = controller;
    target.current = selection;
    const { signal } = controller;
    activeId.current = selection.conversationId ?? null;
    dispatch({ type: 'RESET_CONVERSATION' });
    setHasConnected(false); setError(null); setOpenError(null); setNotice(null); setLoading(true);
    try {
      let id = selection.conversationId;
      let cluster = selection.cluster;
      if (!id && selection.projectId) {
        const { project } = await client.project(selection.projectId, navigationOptions, signal);
        id = project.conversation_id;
        cluster = project.cluster;
      }
      if (!id || signal.aborted) return;
      activeId.current = id;
      const snapshot = await client.snapshot(id, {
        ...navigationOptions,
        xCluster: cluster ?? (selection.projectId ? undefined : navigationOptions.xCluster),
      }, signal);
      if (signal.aborted) return;
      apply(snapshot);
      setAfterSeq(snapshot.through_seq);
      const projectId = snapshot.project?.project_id ?? null;
      updateWorkbenchUrl(projectId, id);
      if (projectId) localStorage.setItem(selectedProjectKey, projectId);
      else localStorage.removeItem(selectedProjectKey);
      localStorage.setItem(selectedKey, id); localStorage.removeItem(newKey);
    } catch (failure) {
      if (!signal.aborted) setOpenError(String(failure));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [apply, client, dispatch, navigationOptions, newKey, resetRequests, selectedKey, selectedProjectKey]);

  const openProject = useCallback((project: ProjectSummary) => {
    void open({ conversationId: project.conversation_id, projectId: project.project_id, cluster: project.cluster });
  }, [open]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    localStorage.setItem(`${storageNamespace}.userId`, userId);
    const params = new URLSearchParams(window.location.search);
    const conversationId = params.get('conversation')?.trim() || undefined;
    const projectId = params.get('project')?.trim() || undefined;
    const initialGeneration = generation.current;
    const listed = client.list(navigationOptions, signal).then(items => {
      if (!signal.aborted) setConversations(current => {
        const byId = new Map(items.map(item => [item.conversation_id, item]));
        for (const item of current) {
          const listed = byId.get(item.conversation_id);
          if (!listed || item.through_seq >= listed.through_seq) {
            byId.set(item.conversation_id, { ...item, title: item.title ?? listed?.title ?? null });
          }
        }
        return [...byId.values()].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
      });
      return items;
    });
    const projectsListed = client.listProjects(navigationOptions, signal).then(items => {
      if (!signal.aborted) setProjects(items);
      return items;
    });

    if (!didRestore.current && (conversationId || projectId)) {
      queueMicrotask(() => {
        if (signal.aborted || generation.current !== initialGeneration) return;
        didRestore.current = true;
        void open({ conversationId, projectId });
      });
    }
    void Promise.allSettled([listed, projectsListed]).then(([conversationsResult, projectsResult]) => {
      if (signal.aborted || didRestore.current || generation.current !== initialGeneration) return;
      didRestore.current = true;
      if (localStorage.getItem(newKey)) return;
      const selection = resolveEchoMindSelection({
        savedProjectId: localStorage.getItem(selectedProjectKey),
        savedConversationId: localStorage.getItem(selectedKey),
        projects: projectsResult.status === 'fulfilled' ? projectsResult.value : [],
        conversations: conversationsResult.status === 'fulfilled' ? conversationsResult.value : [],
      });
      if (selection?.project) openProject(selection.project);
      else if (selection) void open({ conversationId: selection.conversationId });
      else if (conversationsResult.status === 'rejected') setError(String(conversationsResult.reason));
    });
    return () => controller.abort();
  }, [client, navigationOptions, open, openProject, storageNamespace, userId, selectedKey, selectedProjectKey, newKey]);

  useEffect(() => resetRequests, [resetRequests]);

  const scheduleRefresh = useCallback(() => {
    if (inFlight.current) {
      refreshAgain.current = true;
    } else if (refreshTimer.current === null) {
      refreshTimer.current = window.setTimeout(() => {
        refreshTimer.current = null;
        refreshAgain.current = false;
        void refresh().catch(failure => setError(String(failure)));
      }, Math.max(0, 300 - (performance.now() - lastRefresh.current)));
    }
  }, [refresh]);

  const onEvent = useCallback((event: ProductEvent) => {
    if (event.conversation_id !== activeId.current) return;
    if (event.type === 'message.delta') return;
    if (event.type === 'message.started' || event.type === 'message.completed') {
      if (event.payload.role !== 'user') return;
      dispatch({ type: 'APPLY_MESSAGE_EVENTS', events: [event] });
      if (event.type === 'message.started') return;
    }
    if (event.type === 'project.changed') {
      void refreshProjects().catch(failure => setError(String(failure)));
    }
    scheduleRefresh();
  }, [dispatch, refreshProjects, scheduleRefresh]);

  const connection = useProductEventStream({
    conversationId: loading || openError ? null : state.conversationId,
    afterSeq, requestOptions: options, onEvent, onGap: refresh,
    eventsUrl: client.eventsUrl,
  });
  useEffect(() => { if (connection === 'open') setHasConnected(true); }, [connection]);
  useEffect(() => {
    window.addEventListener('focus', scheduleRefresh);
    return () => window.removeEventListener('focus', scheduleRefresh);
  }, [scheduleRefresh]);

  const ensureManager = async () => {
    if (activeId.current) return activeId.current;
    const epoch = generation.current;
    const snapshot = await client.create(options);
    if (epoch !== generation.current) throw new Error('会话已切换');
    const id = snapshot.conversation_id;
    activeId.current = id;
    request.current = new AbortController();
    dispatch({ type: 'SET_CONVERSATION_ID', id });
    apply(snapshot);
    setAfterSeq(snapshot.through_seq);
    setHasConnected(false);
    localStorage.setItem(selectedKey, id);
    localStorage.removeItem(newKey);
    updateWorkbenchUrl(null, id);
    return id;
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
    resetRequests();
    target.current = null;
    activeId.current = null;
    setLoading(false);
    setOpenError(null);
    localStorage.removeItem(selectedKey);
    localStorage.removeItem(selectedProjectKey);
    localStorage.setItem(newKey, '1');
    updateWorkbenchUrl(null, null);
    dispatch({ type: 'RESET_CONVERSATION' });
    setError(null); setNotice(null); setAfterSeq(0); setHasConnected(false);
  };

  const controlManager = async (type: 'cancel' | 'user_message') => {
    const id = activeId.current;
    if (!id || busy) return;
    setBusy(true);
    setError(null);
    try {
      const commandId = crypto.randomUUID();
      const receipt = await client.command(id, type === 'cancel'
        ? { type, command_id: commandId }
        : { type, command_id: commandId, content: [{ type: 'text', text: '用户要求继续已授权的任务。' }] }, options);
      if (receipt.status === 'failed') throw new Error(JSON.stringify(receipt.response));
      await refresh();
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
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
          localStorage.setItem(selectedProjectKey, current.project_id);
          updateWorkbenchUrl(current.project_id, current.conversation_id);
        }
      }).catch(failure => { setError(String(failure)); void refresh(); }).finally(() => setBusy(false));
  };

  const reviewPreparation = async () => {
    const snapshot = state.snapshot, id = activeId.current;
    if (!snapshot?.preparation || !id || busy || preparationPlanStatus(snapshot) !== 'review_required') return;
    const revision = snapshot.preparation.revision;
    if (reviewRequest.current?.conversation !== id || reviewRequest.current.revision !== revision) {
      reviewRequest.current = {conversation: id, revision, command: crypto.randomUUID()};
    }
    setBusy(true);
    setError(null);
    try {
      const receipt = await client.command(id, {
        type: 'review_preparation', command_id: reviewRequest.current.command, expected_preparation_revision: revision,
      }, options);
      reviewRequest.current = null;
      if (receipt.status === 'failed') throw new Error(String(receipt.response.message || '计划核对未提交，请重试。'));
      await refresh();
    } catch (failure) {
      setError(String(failure));
      scheduleRefresh();
    } finally {
      setBusy(false);
    }
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
  const currentProjectId = state.snapshot?.project?.project_id ?? null;
  const pendingCount = (state.snapshot?.pending_inputs?.length ?? 0) + (state.snapshot?.pending_permissions.length ?? 0);
  const queuedCount = state.snapshot?.experiment_queue?.length ?? 0;
  const platformTaskRunning = state.snapshot?.external_tasks?.some(task => task.status === 'running');
  const platformTaskPending = state.snapshot?.external_tasks?.some(task => task.status === 'pending' || task.status === 'waiting');
  const restingStatus = platformTaskRunning ? '项目任务运行中' : platformTaskPending ? '等待任务结果' : queuedCount > 0 ? '等待执行' : null;
  const executionStatus = {
    idle: restingStatus ?? '空闲',
    running: isProject ? '正在执行项目' : '正在准备项目',
    paused: '已暂停',
    waiting_for_confirmation: '等待确认',
    waiting_for_input: '等待回答',
    finished: restingStatus ?? '已结束',
    error: '执行失败',
    stuck: '执行等待超时',
    deleting: '正在删除',
    closed: '已关闭',
  }[state.status];
  const executionEvents = useMemo(() => visibleExecutionEvents(
    isProject ? managerChatEvents(state.events) : state.events,
  ), [isProject, state.events]);
  const progressConnection = deriveDisplayConnectionState({
    conversationId: state.conversationId, isCreating: false, connectionState: connection, hasConnected,
  });
  const [confirmationsOpen, setConfirmationsOpen] = useState(false);
  const confirmationsRef = useRef<HTMLDetailsElement>(null);
  const chatAreaRef = useRef<HTMLElement>(null);
  const openConfirmation = (targetId?: string) => {
    const targetSelector = targetId ? `[data-confirmation-id="${CSS.escape(targetId)}"]` : null;
    if (isProject) {
      const panel = confirmationsRef.current;
      setConfirmationsOpen(true);
      window.requestAnimationFrame(() => {
        const target = targetSelector ? panel?.querySelector(targetSelector) : null;
        (target ?? panel)?.scrollIntoView({ block: 'nearest' });
        (target?.querySelector<HTMLElement>('input, button, textarea') ?? panel?.querySelector('summary'))
          ?.focus({ preventScroll: true });
      });
      return;
    }
    const input = chatAreaRef.current?.querySelector<HTMLElement>(targetSelector ?? 'form[aria-label="回答问题"], [role="dialog"][aria-modal="true"]')
      ?? chatAreaRef.current?.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
    if (input?.tagName === 'FORM') input.scrollIntoView({ block: 'nearest' });
    input?.querySelector<HTMLElement>('button, input, textarea')?.focus({ preventScroll: true });
  };
  const openPlan = () => {
    const plan = chatAreaRef.current?.querySelector<HTMLElement>('section[aria-label="工作流计划草稿"]');
    plan?.scrollIntoView({ block: 'start' });
    plan?.focus({ preventScroll: true });
  };
  useEffect(() => { setConfirmationsOpen(pendingCount > 0); }, [currentProjectId, pendingCount]);

  return <div className="product-planning-chat flex h-screen flex-col bg-white text-left text-slate-900">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
      <div><h1 className="font-semibold">{title}</h1></div>
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
    {loading && <div role="status" className="border-b px-4 py-2 text-xs text-gray-600">加载会话…</div>}
    {openError && <div role="alert" className="border-b bg-red-50 p-3 text-sm text-red-700">{openError}
      <button type="button" className="ml-3 underline" onClick={() => { if (target.current) void open(target.current); }}>重试</button>
    </div>}
    {error && <div role="alert" className="border-b bg-red-50 p-3 text-sm text-red-700">{error}<button type="button" className="ml-3 underline" onClick={() => setError(null)}>关闭</button></div>}
    {notice && <div role="status" className="border-b bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
    <div className="rsi-content-with-sidebar">
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
          {projects.map(project => <button key={project.project_id} type="button" disabled={busy} onClick={() => openProject(project)} className={`block w-full border-b p-3 text-left text-sm disabled:opacity-50 ${project.project_id === currentProjectId ? 'bg-blue-50' : 'hover:bg-white'}`}>
            <span className="block truncate font-medium">{project.name}</span>
            <span className="mt-1 block truncate font-mono text-[10px] text-slate-500">{project.cluster}</span>
            <span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-500">
              <span>{project.lifecycle === 'development' ? '开发中' : '已固化'} · {project.node_count} 节点</span>
              <time className="shrink-0">{new Date(project.updated_at).toLocaleDateString()}</time>
            </span>
          </button>)}
        </section>
        <section className={`${mobilePane === 'conversations' ? 'block' : 'hidden'} min-h-0 overflow-y-auto lg:block`}>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
            <span>对话</span><span className="text-slate-400">{conversations.length}</span>
          </div>
          {conversations.length === 0 && <p className="p-3 text-xs text-slate-400">暂无对话</p>}
          {conversations.map(item => <button key={item.conversation_id} type="button" disabled={busy} onClick={() => void open({ conversationId: item.conversation_id, projectId: item.project_id ?? undefined, cluster: item.cluster ?? undefined })} className={`block w-full border-b p-3 text-left text-sm disabled:opacity-50 ${item.conversation_id === state.conversationId ? 'bg-blue-50' : 'hover:bg-white'}`}>
            <span className="block truncate">{item.title || item.conversation_id.slice(0, 12)}</span>
            <span className="mt-1 block text-[11px] text-slate-500">{item.project_id ? 'Project · 开发中' : '准备中'} · {item.updated_at ? new Date(item.updated_at).toLocaleString() : '新会话'}</span>
          </button>)}
        </section>
      </nav>
      <section className="flex min-h-[480px] min-w-0 flex-col lg:min-h-0">
        {state.snapshot?.project && <StageWorkspace snapshot={state.snapshot} events={executionEvents} options={options} />}
        <section ref={chatAreaRef} aria-label="会话工作区" className="flex min-h-0 flex-1 flex-col bg-white">
        {state.snapshot && <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-slate-50 px-4 py-2">
          <span className="flex items-center gap-2 text-sm text-slate-700" role="status">
            {(state.status === 'running' || platformTaskRunning) && <span aria-hidden="true" className="size-2 rounded-full bg-blue-500" />}
            {executionStatus}
            {queuedCount > 0 && <span className="text-xs text-slate-500">待处理 {queuedCount} 项</span>}
            {pendingCount > 0 && <span className="text-xs text-amber-700">待确认 {pendingCount} 项</span>}
            {progressConnection === 'connecting' && <span className="text-xs text-slate-500">正在同步进度</span>}
            {progressConnection === 'reconnecting' && <span className="text-xs text-amber-700">正在重新连接</span>}
          </span>
          {!state.snapshot.capabilities.read_only && (state.status === 'running' || state.snapshot.automatic_turns_suspended) && (
            <button type="button" disabled={busy} className="rounded border bg-white px-3 py-1 text-xs disabled:opacity-50"
              onClick={() => void controlManager(state.status === 'running' ? 'cancel' : 'user_message')}>
              {state.status === 'running' ? '中断执行' : '继续执行'}
            </button>
          )}
        </div>}
        {state.snapshot?.capabilities.read_only ? <>
          <ChatPanel events={executionEvents} requestOptions={options} status={state.status} conversationId={state.conversationId} />
          <p className="border-t bg-amber-50 px-4 py-2 text-xs text-amber-800">此会话已归档，仅可查看历史记录和产物。请新建会话继续。</p>
        </> : <>
          {!state.conversationId && <PreparationWelcome />}
          {!isProject && state.snapshot && (state.snapshot.preparation?.plan || pendingCount > 0) && <ChatPanel
            events={[]} status={state.status} requestOptions={options} conversationId={state.conversationId}
            pendingInputs={state.snapshot.pending_inputs} pendingPermission={state.snapshot.pending_permissions[0]}
            isRespondingToConfirmation={respondingPermission} onRespondToUserInput={respondToInput} readInputMedia={readInputMedia}
            onRespondToConfirmation={state.snapshot.pending_permissions[0] ? accept => { void respondToPermission(accept); } : undefined}
            contentKey={state.snapshot.preparation?.revision}>
            {state.snapshot.preparation?.plan && <PreparationPlanMessage snapshot={state.snapshot} busy={busy || loading}
              onCreate={createProject} onReview={() => { void reviewPreparation(); }} />}
          </ChatPanel>}
          {state.snapshot && <ExecutionActions snapshot={state.snapshot} onOpenPlan={openPlan}
            onOpenConfirmation={() => openConfirmation()} />}
          <EchoMindAgentChat key={generation.current} client={chatClient} managerId={state.conversationId}
            ensureManager={ensureManager} options={options} disabled={loading || !!openError} />
        </>}
        </section>
      </section>
      {state.snapshot?.project && <details ref={confirmationsRef} className="project-confirmation-slot" open={confirmationsOpen} onToggle={event => setConfirmationsOpen(event.currentTarget.open)}>
        <summary>待确认 <span>{pendingCount} 项</span></summary>
        <ProjectConfirmationPanel snapshot={state.snapshot} onRespond={respondToInput}
        onPermission={async (permissionId, decision, commandId) => {
          const id = activeId.current; if (!id) throw new Error('会话未打开');
          await client.command(id, {type: 'permission_response', command_id: commandId, permission_id: permissionId, decision}, options);
          await refresh();
        }}
        readMedia={readInputMedia} /></details>}
    </main>
    <ProjectOverview snapshot={state.snapshot} client={client} projectId={currentProjectId} options={options} />
    </div>
  </div>;
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
