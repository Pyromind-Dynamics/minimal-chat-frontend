import { useEffect, useRef, useCallback, useState } from 'react';
import { WS_BASE_URL, SESSION_API_KEY } from '../config';
import { setTestAuthCookie } from '../authToken';
import type { ChatEvent } from '../types';

export type WsState = 'connecting' | 'open' | 'closed';

interface UseConversationSocketOptions {
  conversationId: string | null;
  userId?: string;
  onEvent: (event: ChatEvent) => void;
}

/**
 * WebSocket hook that connects to the agent-server event stream.
 * Handles authentication, reconnection, and event parsing.
 */
export function useConversationSocket({ conversationId, userId, onEvent }: UseConversationSocketOptions) {
  const [wsState, setWsState] = useState<WsState>('closed');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(async () => {
    if (!conversationId) return;
    if (userId) {
      await setTestAuthCookie(userId);
    }

    // Build WebSocket URL with resend_mode=all to get history on connect
    const wsUrl = `${WS_BASE_URL}/sockets/events/${conversationId}?resend_mode=all`;
    setWsState('connecting');

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Send first-message auth frame
      if (SESSION_API_KEY && !userId) {
        ws.send(JSON.stringify({ type: 'auth', session_api_key: SESSION_API_KEY }));
      }
      setWsState('open');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ChatEvent;
        onEventRef.current(data);
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    ws.onclose = () => {
      setWsState('closed');
      wsRef.current = null;
      // Auto-reconnect after 3 seconds
      reconnectTimerRef.current = setTimeout(() => {
        void connect();
      }, 3000);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      ws.close();
    };
  }, [conversationId, userId]);

  // Connect when conversationId changes
  useEffect(() => {
    if (!conversationId) return;

    void connect();

    return () => {
      // Cleanup on unmount or conversationId change
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [conversationId, connect]);

  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    void connect();
  }, [connect]);

  return { wsState, reconnect };
}
