import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createEchoMindConversation,
  createProject,
  getEchoMindConversation,
  getEchoMindProject,
  getEchoMindProjectRequest,
  interruptConversation,
  listEchoMindConversations,
  listEchoMindMessages,
  runEchoMindProjectNode,
  sendEchoMindMessage,
  type RequestOptions,
} from './api';
import type {
  EchoMindConversationSummary,
  ProjectEdge,
  ProjectInfo,
  ProjectNode,
  ProjectNodeExecutionResult,
  ProjectRequest,
} from './echomindContract';
import { useChatContext } from './ChatContext';
import { ChatPanel } from './components/ChatPanel';
import { MessageInput } from './components/MessageInput';
import { StatusBar } from './components/StatusBar';
import { formatConversationUpdatedAt } from './conversationList';
import { useConversationSocket } from './hooks/useConversationSocket';
import type { ExecutionStatus } from './types';

const ACTIVE_USER_STORAGE_KEY = 'minimal-chat.activeUserId';
const REQUEST_OVERRIDES_STORAGE_KEY = 'minimal-chat.requestOverrides';
const ACTIVE_CONVERSATION_STORAGE_KEY = 'minimal-chat.echomind.activeConversation.';
const ACTIVE_PROJECT_STORAGE_KEY = 'minimal-chat.echomind.activeProject.';
const FORCE_NEW_SESSION_STORAGE_KEY = 'minimal-chat.echomind.forceNewSession.';
const DEFAULT_USER_ID = '42';

interface RequestOverrideFields {
  cookie: string;
  xCluster: string;
}

function loadUserId(): string {
  const fromQuery = new URLSearchParams(window.location.search)
    .get('userId')
    ?.trim();
  if (fromQuery) return fromQuery;
  return localStorage.getItem(ACTIVE_USER_STORAGE_KEY)?.trim() || DEFAULT_USER_ID;
}

function loadRequestOverrides(): RequestOverrideFields {
  const empty = { cookie: '', xCluster: '' };
  const saved = localStorage.getItem(REQUEST_OVERRIDES_STORAGE_KEY);
  if (!saved) return empty;
  try {
    const parsed = JSON.parse(saved) as Partial<RequestOverrideFields>;
    return {
      cookie: typeof parsed.cookie === 'string' ? parsed.cookie : '',
      xCluster: typeof parsed.xCluster === 'string' ? parsed.xCluster : '',
    };
  } catch {
    return empty;
  }
}

function activeConversationStorageKey(userId: string): string {
  return `${ACTIVE_CONVERSATION_STORAGE_KEY}${userId}`;
}

function activeProjectStorageKey(
  userId: string,
  conversationId: string,
): string {
  return `${ACTIVE_PROJECT_STORAGE_KEY}${userId}.${conversationId}`;
}

function forceNewSessionStorageKey(userId: string): string {
  return `${FORCE_NEW_SESSION_STORAGE_KEY}${userId}`;
}

function saveActiveConversation(userId: string, conversationId: string): void {
  localStorage.setItem(
    activeConversationStorageKey(userId),
    conversationId,
  );
  localStorage.removeItem(forceNewSessionStorageKey(userId));
}

function clearActiveConversation(userId: string): void {
  localStorage.removeItem(activeConversationStorageKey(userId));
  localStorage.setItem(forceNewSessionStorageKey(userId), '1');
}

export function EchoMindChat() {
  const { state, dispatch, handleEvent } = useChatContext();
  const [userId] = useState(loadUserId);
  const [requestOverrides, setRequestOverrides] = useState(loadRequestOverrides);
  const [draftRequestOverrides, setDraftRequestOverrides] =
    useState(loadRequestOverrides);
  const [projectRequest, setProjectRequest] = useState<ProjectRequest | null>(
    null,
  );
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [conversations, setConversations] = useState<
    EchoMindConversationSummary[]
  >([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isInterrupting, setIsInterrupting] = useState(false);
  const [isLoadingRequest, setIsLoadingRequest] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isRestoringConversation, setIsRestoringConversation] = useState(false);
  const [isLoadingConversationList, setIsLoadingConversationList] =
    useState(false);
  const [hasConnected, setHasConnected] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const previousStatus = useRef(state.status);
  const restoreStartedRef = useRef(false);
  const restoreGenerationRef = useRef(0);

  const requestOptions = useMemo<RequestOptions>(
    () => ({
      userId,
      cookie: requestOverrides.cookie,
      xCluster: requestOverrides.xCluster,
    }),
    [requestOverrides.cookie, requestOverrides.xCluster, userId],
  );
  const { wsState } = useConversationSocket({
    conversationId: state.conversationId,
    userId,
    cookie: requestOverrides.cookie,
    xCluster: requestOverrides.xCluster,
    onEvent: handleEvent,
  });

  useEffect(() => {
    setHasConnected(false);
  }, [state.conversationId]);

  useEffect(() => {
    localStorage.setItem(
      REQUEST_OVERRIDES_STORAGE_KEY,
      JSON.stringify(requestOverrides),
    );
  }, [requestOverrides]);

  const openConversation = useCallback(
    async (conversationId: string): Promise<boolean> => {
      const generation = restoreGenerationRef.current + 1;
      restoreGenerationRef.current = generation;
      setIsRestoringConversation(true);
      setLocalError(null);
      setProjectRequest(null);
      setProject(null);

      try {
        const restoredConversation = await getEchoMindConversation(
          conversationId,
          requestOptions,
        );
        if (generation !== restoreGenerationRef.current) return false;
        if (!restoredConversation) {
          localStorage.removeItem(activeConversationStorageKey(userId));
          return false;
        }

        saveActiveConversation(userId, conversationId);
        dispatch({
          type: 'SET_CONVERSATION_ID',
          id: restoredConversation.conversationId,
        });
        dispatch({
          type: 'SET_STATUS',
          status: restoredConversation.conversation
            .execution_status as ExecutionStatus,
        });

        const [events, request] = await Promise.all([
          listEchoMindMessages(conversationId, requestOptions),
          getEchoMindProjectRequest(conversationId, requestOptions),
        ]);
        if (generation !== restoreGenerationRef.current) return false;
        dispatch({ type: 'SET_EVENTS', events });
        setProjectRequest(request);

        const projectId = localStorage.getItem(
          activeProjectStorageKey(userId, conversationId),
        );
        if (projectId) {
          const restoredProject = await getEchoMindProject(
            projectId,
            requestOptions,
          );
          if (generation !== restoreGenerationRef.current) return false;
          if (restoredProject) {
            setProject(restoredProject);
          } else {
            localStorage.removeItem(
              activeProjectStorageKey(userId, conversationId),
            );
          }
        }
        return true;
      } catch (error) {
        if (generation !== restoreGenerationRef.current) return false;
        setLocalError(error instanceof Error ? error.message : 'Unknown error');
        return false;
      } finally {
        if (generation === restoreGenerationRef.current) {
          setIsRestoringConversation(false);
        }
      }
    },
    [dispatch, requestOptions, userId],
  );

  const refreshConversationList = useCallback(async () => {
    setIsLoadingConversationList(true);
    try {
      const items = await listEchoMindConversations(requestOptions);
      setConversations(items);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoadingConversationList(false);
    }
  }, [requestOptions]);

  useEffect(() => {
    if (restoreStartedRef.current) return;
    restoreStartedRef.current = true;
    setIsLoadingConversationList(true);

    void (async () => {
      try {
        const items = await listEchoMindConversations(requestOptions);
        setConversations(items);
        if (localStorage.getItem(forceNewSessionStorageKey(userId))) return;

        const savedConversationId = localStorage.getItem(
          activeConversationStorageKey(userId),
        );
        const preferred = savedConversationId
          ? items.find(
              (conversation) =>
                conversation.conversationId === savedConversationId,
            )
          : undefined;
        const selected = preferred ?? items[0];
        if (selected) {
          await openConversation(selected.conversationId);
        } else if (savedConversationId) {
          localStorage.removeItem(activeConversationStorageKey(userId));
        }
      } catch (error) {
        setLocalError(error instanceof Error ? error.message : 'Unknown error');
      } finally {
        setIsLoadingConversationList(false);
      }
    })();
  }, [openConversation, requestOptions, userId]);

  useEffect(() => {
    if (wsState === 'open') setHasConnected(true);
  }, [wsState]);

  const handleSend = async (text: string) => {
    if (isSending || isCreating) return;
    setLocalError(null);
    setIsSending(true);
    try {
      if (!state.conversationId) {
        setIsCreating(true);
        const created = await createEchoMindConversation({
          initialMessage: text,
          options: requestOptions,
        });
        saveActiveConversation(userId, created.conversationId);
        dispatch({
          type: 'SET_CONVERSATION_ID',
          id: created.conversationId,
        });
        setConversations((current) => [
          {
            conversationId: created.conversationId,
            agentProfile: 'echomind',
            title: text.trim().slice(0, 80) || null,
            executionStatus: created.conversation.execution_status,
            createdAt: created.conversation.created_at,
            updatedAt: created.conversation.updated_at,
          },
          ...current.filter(
            (conversation) =>
              conversation.conversationId !== created.conversationId,
          ),
        ]);
        setProjectRequest(null);
        setProject(null);
      } else {
        await sendEchoMindMessage(state.conversationId, text, requestOptions);
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsCreating(false);
      setIsSending(false);
    }
  };

  const handleInterrupt = async () => {
    if (!state.conversationId || isInterrupting) return;
    setIsInterrupting(true);
    setLocalError(null);
    try {
      await interruptConversation(state.conversationId, requestOptions);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsInterrupting(false);
    }
  };

  const refreshProjectRequest = useCallback(async () => {
    if (!state.conversationId || isLoadingRequest) return;
    setIsLoadingRequest(true);
    setLocalError(null);
    try {
      const request = await getEchoMindProjectRequest(
        state.conversationId,
        requestOptions,
      );
      setProjectRequest(request);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoadingRequest(false);
    }
  }, [isLoadingRequest, requestOptions, state.conversationId]);

  useEffect(() => {
    const finishedRunning =
      previousStatus.current === 'running' && state.status !== 'running';
    previousStatus.current = state.status;
    if (finishedRunning && state.conversationId) {
      void refreshProjectRequest();
    }
  }, [refreshProjectRequest, state.conversationId, state.status]);

  const handleCreateProject = async () => {
    if (!state.conversationId || !projectRequest || isCreatingProject) return;
    setIsCreatingProject(true);
    setLocalError(null);
    try {
      const created = await createProject(state.conversationId, requestOptions);
      localStorage.setItem(
        activeProjectStorageKey(userId, state.conversationId),
        created.project.project_id,
      );
      setProject(created);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleNewConversation = () => {
    restoreGenerationRef.current += 1;
    clearActiveConversation(userId);
    dispatch({ type: 'RESET_CONVERSATION' });
    setProjectRequest(null);
    setProject(null);
    setLocalError(null);
    setIsRestoringConversation(false);
  };

  const handleApplyRequestOverrides = () => {
    setRequestOverrides({
      cookie: draftRequestOverrides.cookie.trim(),
      xCluster: draftRequestOverrides.xCluster.trim(),
    });
  };

  const error = localError || state.error;
  const isRunning = state.status === 'running';

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-left text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto w-full max-w-[1920px]">
          <div className="flex w-full items-center justify-between gap-2">
            <a
              href="./"
              className="shrink-0 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Workbench
            </a>
            <div className="flex min-w-0 items-center justify-end gap-2">
              <span className="truncate font-mono text-xs text-slate-500">
                user {userId}
              </span>
              <button
                type="button"
                onClick={handleNewConversation}
                disabled={isRunning || isCreating || isRestoringConversation}
                className="shrink-0 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                New session
              </button>
            </div>
          </div>
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-base font-semibold">EchoMind Agent</span>
            <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium uppercase text-blue-700">
              echomind
            </span>
            <span className="text-xs text-slate-500">
              先补齐需求，确认后才创建 Project；Graph 属于 Project
            </span>
          </div>
        </div>
      </header>

      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <form
          className="mx-auto grid w-full max-w-[1920px] gap-2 sm:grid-cols-[minmax(220px,1fr)_minmax(160px,220px)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            handleApplyRequestOverrides();
          }}
        >
          <label className="min-w-0">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              Cookie
            </span>
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
              className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs outline-none focus:border-blue-500"
            />
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              x-cluster
            </span>
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
              className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs outline-none focus:border-blue-500"
            />
          </label>
          <button
            type="submit"
            className="self-end rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Apply
          </button>
        </form>
      </div>

      <StatusBar
        wsState={wsState}
        status={state.status}
        conversationId={state.conversationId}
        isCreating={isCreating}
        hasConnected={hasConnected}
      />

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          <div className="mx-auto flex w-full max-w-[1920px] items-start gap-3">
            <span className="min-w-0 flex-1 whitespace-pre-wrap">{error}</span>
            <button
              type="button"
              onClick={() => {
                setLocalError(null);
                dispatch({ type: 'SET_ERROR', error: null });
              }}
              className="shrink-0 underline"
            >
              dismiss
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto flex min-h-0 w-full max-w-[1920px] flex-1 flex-col overflow-y-auto bg-white lg:grid lg:grid-cols-[220px_minmax(0,1fr)_360px] lg:overflow-hidden xl:grid-cols-[240px_minmax(0,1fr)_460px]">
        <ConversationList
          conversations={conversations}
          activeConversationId={state.conversationId}
          isLoading={isLoadingConversationList}
          disabled={isRunning || isCreating || isRestoringConversation}
          onOpen={(conversationId) => {
            void openConversation(conversationId);
          }}
          onNew={handleNewConversation}
          onRefresh={() => {
            void refreshConversationList();
          }}
        />
        <section className="flex min-h-[520px] min-w-0 flex-1 flex-col lg:min-h-0">
          <ChatPanel
            events={state.events}
            conversationId={state.conversationId}
            requestOptions={requestOptions}
            status={state.status}
            isCondensing={state.isCondensing}
          />
          <MessageInput
            onSend={(text) => {
              void handleSend(text);
            }}
            onInterrupt={() => {
              void handleInterrupt();
            }}
            canInterrupt={
              Boolean(state.conversationId) && isRunning && !isInterrupting
            }
            interrupting={isInterrupting}
            status={state.status}
            sending={isSending}
            disabled={
              isCreating
              || isRestoringConversation
              || state.status === 'deleting'
            }
          />
        </section>

        <ProjectPanel
          conversationId={state.conversationId}
          projectRequest={projectRequest}
          project={project}
          requestOptions={requestOptions}
          isLoadingRequest={isLoadingRequest}
          isCreatingProject={isCreatingProject}
          isRestoringConversation={isRestoringConversation}
          onRefresh={() => {
            void refreshProjectRequest();
          }}
          onCreate={() => {
            void handleCreateProject();
          }}
        />
      </main>
    </div>
  );
}

interface ConversationListProps {
  conversations: EchoMindConversationSummary[];
  activeConversationId: string | null;
  isLoading: boolean;
  disabled: boolean;
  onOpen: (conversationId: string) => void;
  onNew: () => void;
  onRefresh: () => void;
}

function ConversationList({
  conversations,
  activeConversationId,
  isLoading,
  disabled,
  onOpen,
  onNew,
  onRefresh,
}: ConversationListProps) {
  return (
    <aside className="max-h-72 shrink-0 overflow-y-auto border-b border-slate-200 bg-slate-50 lg:max-h-none lg:min-h-0 lg:border-b-0 lg:border-r">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Sessions</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {conversations.length} EchoMind
            </p>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onNew}
              disabled={disabled}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              New
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              {isLoading ? '...' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {!isLoading && conversations.length === 0 && (
        <p className="px-3 py-6 text-sm text-slate-500">
          还没有 EchoMind 会话。
        </p>
      )}
      {conversations.map((conversation) => {
        const isActive =
          conversation.conversationId === activeConversationId;
        return (
          <button
            key={conversation.conversationId}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            title={conversation.conversationId}
            onClick={() => onOpen(conversation.conversationId)}
            disabled={disabled || isActive}
            className={`block w-full border-b border-slate-200 px-3 py-3 text-left disabled:cursor-default ${
              isActive ? 'bg-white' : 'hover:bg-white disabled:hover:bg-slate-50'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium text-slate-900">
                {conversation.title?.trim()
                  || conversation.conversationId.slice(0, 8)}
              </span>
              <span className="shrink-0 text-[10px] uppercase text-slate-400">
                {conversation.executionStatus}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
              <span className="font-mono">
                {conversation.conversationId.slice(0, 8)}
              </span>
              <time
                className="shrink-0"
                dateTime={conversation.updatedAt}
                title={formatConversationUpdatedAt(conversation.updatedAt)}
              >
                {formatConversationUpdatedAt(conversation.updatedAt)}
              </time>
            </div>
          </button>
        );
      })}
    </aside>
  );
}

interface ProjectPanelProps {
  conversationId: string | null;
  projectRequest: ProjectRequest | null;
  project: ProjectInfo | null;
  requestOptions: RequestOptions;
  isLoadingRequest: boolean;
  isCreatingProject: boolean;
  isRestoringConversation: boolean;
  onRefresh: () => void;
  onCreate: () => void;
}

function ProjectPanel({
  conversationId,
  projectRequest,
  project,
  requestOptions,
  isLoadingRequest,
  isCreatingProject,
  isRestoringConversation,
  onRefresh,
  onCreate,
}: ProjectPanelProps) {
  return (
    <aside className="border-t border-slate-200 bg-slate-50 p-4 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Project</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            需求请求由 EchoMind Agent 写入，服务端校验后创建 Project。
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={!conversationId || isLoadingRequest}
          className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          {isLoadingRequest ? '读取中' : '刷新需求'}
        </button>
      </div>

      {!conversationId && (
        <p className="mt-5 text-sm text-slate-500">
          {isRestoringConversation
            ? '正在恢复上一次 EchoMind 会话...'
            : '先在对话里说明训练目标，EchoMind Agent 会补齐需求。'}
        </p>
      )}

      {conversationId && !projectRequest && !project && (
        <div className="mt-5 border-y border-slate-200 py-4 text-sm text-slate-500">
          还没有完整的 Project 创建请求。需求齐备后刷新这里。
        </div>
      )}

      {project && (
        <div className="mt-5 space-y-4">
          <div className="border-y border-emerald-200 bg-emerald-50 px-3 py-3">
            <p className="text-xs font-semibold uppercase text-emerald-700">
              Project created
            </p>
            <p className="mt-2 text-sm font-medium text-slate-900">
              {project.project.name}
            </p>
            <p className="mt-1 break-all font-mono text-xs text-slate-600">
              {project.project.project_id}
            </p>
          </div>
          <GraphPreview
            projectId={project.project.project_id}
            template={project.graph.template}
            nodes={project.graph.nodes}
            edges={project.graph.edges}
            requestOptions={requestOptions}
          />
        </div>
      )}

      {projectRequest && !project && (
        <div className="mt-5 space-y-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900">
                {projectRequest.name}
              </h3>
              <span className="rounded bg-slate-200 px-2 py-0.5 font-mono text-[11px] text-slate-600">
                {projectRequest.skill}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {projectRequest.description}
            </p>
          </div>

          <section>
            <h3 className="text-xs font-semibold uppercase text-slate-500">
              Project Request
            </h3>
            <ul className="mt-2 divide-y divide-slate-200 border-y border-slate-200">
              {projectRequest.requirements.map((requirement) => (
                <li
                  key={requirement.key}
                  className="flex items-start justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-700">
                      {requirement.label}
                    </p>
                    <p className="mt-0.5 break-words text-xs text-slate-500">
                      {requirement.value || '未填写'}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      requirement.status === 'confirmed'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {requirement.status}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <button
            type="button"
            onClick={onCreate}
            disabled={isCreatingProject}
            className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {isCreatingProject ? '正在创建 Project…' : '创建 Project'}
          </button>
        </div>
      )}
    </aside>
  );
}

interface GraphPreviewProps {
  projectId: string;
  template: string | null;
  nodes: ProjectNode[];
  edges: ProjectEdge[];
  requestOptions: RequestOptions;
}

function orderGraphNodes(
  nodes: ProjectNode[],
  edges: ProjectEdge[],
): ProjectNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }

  const queue = nodes.filter((node) => incoming.get(node.id) === 0);
  const ordered: ProjectNode[] = [];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) break;
    ordered.push(node);
    for (const targetId of outgoing.get(node.id) ?? []) {
      const remaining = (incoming.get(targetId) ?? 1) - 1;
      incoming.set(targetId, remaining);
      const target = byId.get(targetId);
      if (remaining === 0 && target) queue.push(target);
    }
  }
  return ordered.length === nodes.length ? ordered : nodes;
}

function nodeSummary(node: ProjectNode): string {
  const config = node.config;
  const value = (key: string) =>
    typeof config[key] === 'string' ? config[key] : '';

  if (node.type === 'dataset') {
    return [value('format'), value('image_roles')].filter(Boolean).join(' · ');
  }
  if (node.type === 'inference') return value('model');
  if (node.type === 'evaluator') return value('rule');
  return [value('method').toUpperCase(), value('artifact_goal')]
    .filter(Boolean)
    .join(' · ');
}

function nodeStatusClass(status: ProjectNode['status']): string {
  if (status === 'succeeded') return 'bg-emerald-100 text-emerald-700';
  if (status === 'running') return 'bg-blue-100 text-blue-700';
  if (status === 'failed') return 'bg-rose-100 text-rose-700';
  if (status === 'not_implemented') return 'bg-amber-100 text-amber-700';
  if (status === 'skipped') return 'bg-slate-200 text-slate-600';
  return 'bg-slate-100 text-slate-600';
}

function GraphPreview({
  projectId,
  template,
  nodes,
  edges,
  requestOptions,
}: GraphPreviewProps) {
  const orderedNodes = useMemo(() => orderGraphNodes(nodes, edges), [nodes, edges]);
  const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
  const [execution, setExecution] =
    useState<ProjectNodeExecutionResult | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);

  const runShell = async (nodeId: string) => {
    setRunningNodeId(nodeId);
    setExecutionError(null);
    try {
      const result = await runEchoMindProjectNode(
        projectId,
        nodeId,
        requestOptions,
      );
      setExecution(result);
    } catch (error) {
      setExecutionError(
        error instanceof Error ? error.message : 'Failed to run Project node.',
      );
    } finally {
      setRunningNodeId(null);
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase text-slate-500">Graph</h3>
        {template && (
          <span className="font-mono text-[10px] text-slate-500">{template}</span>
        )}
      </div>
      {nodes.length === 0 && (
        <p className="mt-2 text-xs text-slate-500">
          Project 已创建，Graph 容器尚未配置节点。
        </p>
      )}
      {nodes.length > 0 && (
        <div className="mt-3">
          <ol className="space-y-1">
            {orderedNodes.map((node, index) => {
              const displayedStatus =
                execution?.node_id === node.id ? execution.status : node.status;
              return (
                <Fragment key={node.id}>
                  <li className="flex min-h-28 w-full flex-col rounded-lg border border-slate-300 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {node.title}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] uppercase text-slate-400">
                          {node.type}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${nodeStatusClass(displayedStatus)}`}
                      >
                        {displayedStatus.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="mt-3 max-h-12 overflow-hidden break-words text-[11px] leading-4 text-slate-600">
                      {nodeSummary(node) || 'No configuration yet'}
                    </p>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                      <span className="truncate font-mono text-[10px] text-slate-400">
                        {node.executor}
                      </span>
                      <button
                        type="button"
                        onClick={() => void runShell(node.id)}
                        disabled={runningNodeId !== null}
                        className="rounded-md border border-slate-300 px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                      >
                        {runningNodeId === node.id ? 'Checking' : 'Run shell'}
                      </button>
                    </div>
                  </li>
                  {index < orderedNodes.length - 1 && (
                    <li
                      aria-hidden="true"
                      className="flex h-5 items-center justify-center text-slate-400"
                    >
                      ↓
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ol>
        </div>
      )}
      {execution && (
        <p className="mt-1 border-y border-amber-200 bg-amber-50 px-2 py-2 text-[11px] leading-5 text-amber-800">
          {execution.node_id}: {execution.message}
        </p>
      )}
      {executionError && (
        <p className="mt-2 border-y border-rose-200 bg-rose-50 px-2 py-2 text-[11px] leading-5 text-rose-700">
          {executionError}
        </p>
      )}
    </section>
  );
}
