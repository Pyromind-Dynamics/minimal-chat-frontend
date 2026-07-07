import { getDebugAuthHeaders } from './authToken';
import { BACKEND_URL, SESSION_API_KEY, LLM_MODEL, LLM_API_KEY, LLM_BASE_URL } from './config';
import { applyRequestCookies, normalizeRequestValue, type RequestOverrides } from './requestOverrides';
import type {
  ChatEvent,
  ConversationInfo,
  ConversationPage,
  EventPage,
  PyromindForkAtEventResult,
} from './types';

interface RequestOptions extends RequestOverrides {
  userId?: string;
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
  workflowDsl?: string,
): Promise<ConversationInfo> {
  await prepareAuth(options);
  const body: Record<string, unknown> = {
    llm: {
      model: LLM_MODEL || undefined,
      api_key: LLM_API_KEY || undefined,
      base_url: LLM_BASE_URL || undefined,
    },
    message: initialMessage || undefined,
    workflow_dsl: workflowDsl || undefined,
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

export async function sendPyromindMessage(
  conversationId: string,
  text: string,
  workflowDsl: string | null,
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
        workflow_dsl: workflowDsl,
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
