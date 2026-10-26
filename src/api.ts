import { getDebugAuthHeaders } from './authToken';
import { formatApiError } from './apiError';
import { BACKEND_URL, SESSION_API_KEY, LLM_MODEL, LLM_API_KEY, LLM_BASE_URL } from './config';
import { applyRequestCookies, normalizeRequestValue, type RequestOverrides } from './requestOverrides';
import type {
  ChatEvent,
  CommandReceipt,
  ConversationInfo,
  ConversationPage,
  ConversationSnapshot,
  EventPage,
  ProductEvent,
  PyromindForkAtEventResult,
  UserInputAnswer,
} from './types';

interface RequestOptions extends RequestOverrides {
  userId?: string;
}

export type { RequestOptions };

const PRODUCT_API = `${BACKEND_URL}/api/v2/pyromind/conversations`;

export async function prepareProductRequest(
  options?: RequestOptions,
): Promise<void> {
  await prepareAuth(options);
}

export function getProductRequestHeaders(
  options?: RequestOptions,
): Record<string, string> {
  return getHeaders(options);
}

export function productEventsUrl(
  conversationId: string,
  afterSeq: number,
): string {
  const params = new URLSearchParams({ afterSeq: String(afterSeq) });
  return `${PRODUCT_API}/${conversationId}/events?${params}`;
}

export async function createProductConversation(
  initialMessage?: string,
  options?: RequestOptions,
  userInputEnabled = false,
): Promise<ConversationSnapshot> {
  return productRequest<ConversationSnapshot>(
    PRODUCT_API,
    {
      method: 'POST',
      body: JSON.stringify({
        llm: {
          model: LLM_MODEL || undefined,
          api_key: LLM_API_KEY || undefined,
          base_url: LLM_BASE_URL || undefined,
        },
        message: initialMessage || undefined,
        user_input_enabled: userInputEnabled,
        extra: {},
      }),
    },
    options,
  );
}

export async function listProductConversations(
  options?: RequestOptions,
): Promise<ConversationSnapshot[]> {
  return productRequest<ConversationSnapshot[]>(PRODUCT_API, {}, options);
}

export async function getProductSnapshot(
  conversationId: string,
  options?: RequestOptions,
): Promise<ConversationSnapshot> {
  return productRequest<ConversationSnapshot>(
    `${PRODUCT_API}/${conversationId}/snapshot`,
    {},
    options,
  );
}

export async function sendProductMessage(
  conversationId: string,
  text: string,
  options?: RequestOptions,
  commandId: string = crypto.randomUUID(),
): Promise<CommandReceipt> {
  return submitProductCommand(
    conversationId,
    {
      command_id: commandId,
      type: 'user_message',
      content: [{ type: 'text', text }],
    },
    options,
  );
}

export async function cancelProductConversation(
  conversationId: string,
  options?: RequestOptions,
): Promise<CommandReceipt> {
  return submitProductCommand(
    conversationId,
    { command_id: crypto.randomUUID(), type: 'cancel' },
    options,
  );
}

export async function respondToProductInput(
  conversationId: string,
  requestId: string,
  status: 'answered' | 'cancelled',
  answers: UserInputAnswer[],
  options: RequestOptions,
  commandId: string,
): Promise<CommandReceipt> {
  return submitProductCommand(conversationId, {
    command_id: commandId,
    type: 'input_response',
    request_id: requestId,
    status,
    answers,
  }, options);
}

export async function respondToProductPermission(
  conversationId: string,
  permissionId: string,
  accept: boolean,
  options?: RequestOptions,
): Promise<CommandReceipt> {
  return submitProductCommand(
    conversationId,
    {
      command_id: crypto.randomUUID(),
      type: 'permission_response',
      permission_id: permissionId,
      decision: accept ? 'allow_once' : 'deny',
      reason: accept ? undefined : 'User rejected the pending action.',
    },
    options,
  );
}

export async function forkProductConversation(
  conversationId: string,
  eventId: string,
  options?: RequestOptions,
): Promise<ConversationSnapshot> {
  return productRequest<ConversationSnapshot>(
    `${PRODUCT_API}/${conversationId}/forks`,
    { method: 'POST', body: JSON.stringify({ eventId }) },
    options,
  );
}

export function parseProductEvent(data: string): ProductEvent {
  const parsed = JSON.parse(data) as ProductEvent;
  if (
    !parsed
    || typeof parsed !== 'object'
    || typeof parsed.conversation_id !== 'string'
    || typeof parsed.seq !== 'number'
    || typeof parsed.type !== 'string'
  ) {
    throw new Error('Invalid ProductEvent payload');
  }
  return parsed;
}

async function submitProductCommand(
  conversationId: string,
  command: Record<string, unknown>,
  options?: RequestOptions,
): Promise<CommandReceipt> {
  return productRequest<CommandReceipt>(
    `${PRODUCT_API}/${conversationId}/commands`,
    { method: 'POST', body: JSON.stringify(command) },
    options,
  );
}

async function productRequest<T>(
  url: string,
  init: RequestInit,
  options?: RequestOptions,
): Promise<T> {
  await prepareProductRequest(options);
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { ...getProductRequestHeaders(options), ...init.headers },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(formatApiError(response.status, detail));
  }
  return response.json() as Promise<T>;
}

export interface DataPreparationProgress {
  output_dir: string;
  progress_found: boolean;
  total: number | null;
  processed: number | null;
  succeeded: number | null;
  failed: number | null;
  elapsed_ms: number | null;
  records_per_second: number | null;
  eta_ms: number | null;
  updated_at: string | null;
  percent: number | null;
  latest_records: Record<string, unknown>[];
}

export interface DebugUrlResult {
  url: string;
  context_source: string;
  conversation_id?: string | null;
  status_code: number;
  forwarded_headers: Record<string, string>;
  response_headers: Record<string, string>;
  body: string;
}

async function prepareAuth(options?: RequestOptions): Promise<void> {
  await applyRequestCookies(options?.cookie);
}

function getHeaders(options?: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getDebugAuthHeaders(options?.userId),
  };
  if (SESSION_API_KEY && !options?.userId) {
    headers['X-Session-API-Key'] = SESSION_API_KEY;
  }
  const xCluster = normalizeRequestValue(options?.xCluster);
  if (xCluster) {
    headers['x-cluster'] = xCluster;
  }
  return headers;
}

/**
 * Create a new conversation with the Pyromind knowledge-base agent.
 * The server assembles system_prompt, tools, and workspace internally.
 */
export async function createConversation(
  initialMessage?: string,
  options?: RequestOptions,
): Promise<ConversationInfo> {
  await prepareAuth(options);
  const body: Record<string, unknown> = {
    llm: {
      model: LLM_MODEL || undefined,
      api_key: LLM_API_KEY || undefined,
      base_url: LLM_BASE_URL || undefined,
    },
    message: initialMessage || undefined,
    extra: {},  // Extensible: e.g. { knowledge_base_path, language, custom_instructions }
  };

  const res = await fetch(`${BACKEND_URL}/api/pyromind/conversations`, {
    method: 'POST',
    headers: getHeaders(options),
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to create conversation: ${res.status} ${errorText}`);
  }

  return res.json();
}

/**
 * Send a message to an existing conversation.
 * Setting run=true automatically triggers the agent to process the message.
 */
export async function sendMessage(
  conversationId: string,
  text: string,
  options?: RequestOptions,
): Promise<void> {
  await prepareAuth(options);
  const res = await fetch(`${BACKEND_URL}/api/conversations/${conversationId}/events`, {
    method: 'POST',
    headers: getHeaders(options),
    credentials: 'include',
    body: JSON.stringify({
      role: 'user',
      content: [{ type: 'text', text }],
      run: true,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to send message: ${res.status} ${errorText}`);
  }
}

export async function respondToConfirmation(
  conversationId: string,
  accept: boolean,
  reason: string,
  options?: RequestOptions,
): Promise<void> {
  await prepareAuth(options);
  const res = await fetch(
    `${BACKEND_URL}/api/conversations/${conversationId}/events/respond_to_confirmation`,
    {
      method: 'POST',
      headers: getHeaders(options),
      credentials: 'include',
      body: JSON.stringify({ accept, reason }),
    },
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `Failed to respond to confirmation: ${res.status} ${errorText}`,
    );
  }
}

export async function sendPyromindMessage(
  conversationId: string,
  text: string,
  options?: RequestOptions,
): Promise<void> {
  await prepareAuth(options);
  const res = await fetch(
    `${BACKEND_URL}/api/pyromind/conversations/${conversationId}/messages`,
    {
      method: 'POST',
      headers: getHeaders(options),
      credentials: 'include',
      body: JSON.stringify({
        text,
        run: true,
      }),
    },
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to send message: ${res.status} ${errorText}`);
  }
}

export async function forkPyromindConversationAtEvent(
  conversationId: string,
  eventId: string,
  options?: RequestOptions,
): Promise<PyromindForkAtEventResult> {
  await prepareAuth(options);
  const res = await fetch(
    `${BACKEND_URL}/api/pyromind/conversations/${conversationId}/fork-at-event`,
    {
      method: 'POST',
      headers: getHeaders(options),
      credentials: 'include',
      body: JSON.stringify({ eventId }),
    },
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to roll back conversation: ${res.status} ${errorText}`);
  }

  return res.json();
}

export async function listConversations(options?: RequestOptions): Promise<ConversationInfo[]> {
  await prepareAuth(options);
  const params = new URLSearchParams({
    limit: '100',
    sort_order: 'UPDATED_AT_DESC',
  });
  const res = await fetch(`${BACKEND_URL}/api/conversations/search?${params}`, {
    headers: getHeaders(options),
    credentials: 'include',
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to list conversations: ${res.status} ${errorText}`);
  }

  const page = (await res.json()) as ConversationPage;
  return page.items;
}

export async function listConversationEvents(
  conversationId: string,
  options?: RequestOptions,
): Promise<ChatEvent[]> {
  await prepareAuth(options);
  const events: ChatEvent[] = [];
  let pageId: string | null = null;

  do {
    const params = new URLSearchParams({
      limit: '100',
      sort_order: 'TIMESTAMP',
    });
    if (pageId) {
      params.set('page_id', pageId);
    }
    const res = await fetch(
      `${BACKEND_URL}/api/conversations/${conversationId}/events/search?${params}`,
      {
        headers: getHeaders(options),
        credentials: 'include',
      },
    );

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to list events: ${res.status} ${errorText}`);
    }

    const page = (await res.json()) as EventPage;
    events.push(...page.items);
    pageId = page.next_page_id;
  } while (pageId);

  return events;
}

export async function requestDebugUrl(
  url: string,
  conversationId: string,
  options?: RequestOptions,
): Promise<DebugUrlResult> {
  await prepareAuth(options);
  const body: Record<string, string> = { url, conversation_id: conversationId };
  const res = await fetch(`${BACKEND_URL}/api/pyromind/debug/request-url`, {
    method: 'POST',
    headers: getHeaders(options),
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to request debug URL: ${res.status} ${errorText}`);
  }

  return res.json();
}

/**
 * Poll the live progress of a submitted DataFlow pipeline run.
 * Reads progress.json and the tail of processed.jsonl from the run's
 * Storage output directory.
 */
export async function getDataPreparationProgress(
  outputDir: string,
  options?: RequestOptions,
  tailLines = 5,
): Promise<DataPreparationProgress> {
  await prepareAuth(options);
  const params = new URLSearchParams({
    output_dir: outputDir,
    tail_lines: String(tailLines),
  });
  const res = await fetch(
    `${BACKEND_URL}/api/pyromind/data-preparation/progress?${params}`,
    {
      headers: getHeaders(options),
      credentials: 'include',
      cache: 'no-store',
    },
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to load progress: ${res.status} ${errorText}`);
  }

  return res.json();
}
