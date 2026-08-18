import { getDebugAuthHeaders } from './authToken';
import { BACKEND_URL, SESSION_API_KEY } from './config';
import {
  applyRequestCookies,
  normalizeRequestValue,
  type RequestOverrides,
} from './requestOverrides';
import type {
  CommandReceipt,
  ConversationSnapshot,
  ProductEvent,
} from './types';

interface RequestOptions extends RequestOverrides {
  userId?: string;
}

export type { RequestOptions };

const PRODUCT_API = `${BACKEND_URL}/api/v2/pyromind/conversations`;

export async function prepareProductRequest(options?: RequestOptions): Promise<void> {
  await applyRequestCookies(options?.cookie);
}

export function getProductRequestHeaders(
  options?: RequestOptions,
): Record<string, string> {
  const headers: Record<string, string> = {
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

export function productEventsUrl(conversationId: string, afterSeq: number): string {
  const params = new URLSearchParams({ afterSeq: String(afterSeq) });
  return `${PRODUCT_API}/${conversationId}/events?${params}`;
}

export async function createConversation(
  options?: RequestOptions,
): Promise<ConversationSnapshot> {
  return requestJson<ConversationSnapshot>(PRODUCT_API, {
    method: 'POST',
    body: JSON.stringify({}),
  }, options);
}

export async function listConversations(
  options?: RequestOptions,
): Promise<ConversationSnapshot[]> {
  return requestJson<ConversationSnapshot[]>(PRODUCT_API, {}, options);
}

export async function getConversationSnapshot(
  conversationId: string,
  options?: RequestOptions,
): Promise<ConversationSnapshot> {
  return requestJson<ConversationSnapshot>(
    `${PRODUCT_API}/${conversationId}/snapshot`,
    {},
    options,
  );
}

export async function sendUserMessage(
  conversationId: string,
  text: string,
  options?: RequestOptions,
): Promise<CommandReceipt> {
  return submitCommand(conversationId, {
    command_id: crypto.randomUUID(),
    type: 'user_message',
    content: [{ type: 'text', text }],
  }, options);
}

export async function cancelConversation(
  conversationId: string,
  options?: RequestOptions,
): Promise<CommandReceipt> {
  return submitCommand(conversationId, {
    command_id: crypto.randomUUID(),
    type: 'cancel',
  }, options);
}

export async function respondToPermission(
  conversationId: string,
  permissionId: string,
  decision: 'allow_once' | 'deny',
  options?: RequestOptions,
): Promise<CommandReceipt> {
  return submitCommand(conversationId, {
    command_id: crypto.randomUUID(),
    type: 'permission_response',
    permission_id: permissionId,
    decision,
  }, options);
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

async function submitCommand(
  conversationId: string,
  command: Record<string, unknown>,
  options?: RequestOptions,
): Promise<CommandReceipt> {
  return requestJson<CommandReceipt>(
    `${PRODUCT_API}/${conversationId}/commands`,
    { method: 'POST', body: JSON.stringify(command) },
    options,
  );
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  options?: RequestOptions,
): Promise<T> {
  await prepareProductRequest(options);
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...getProductRequestHeaders(options),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Request failed: ${response.status} ${detail}`);
  }
  return response.json() as Promise<T>;
}
