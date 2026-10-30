import { useEffect, useRef, useState } from 'react';
import {
  getProductRequestHeaders,
  parseProductEvent,
  prepareProductRequest,
  productEventsUrl,
  type RequestOptions,
} from '../api';
import type { ProductEvent } from '../types';
import { classifyProductSequence } from '../productStreamState';

export type ConnectionState = 'connecting' | 'open' | 'closed';

interface ProductEventStreamOptions {
  conversationId: string | null;
  afterSeq: number;
  requestOptions: RequestOptions;
  onEvent: (event: ProductEvent) => void;
  onGap: () => Promise<number>;
  eventsUrl?: typeof productEventsUrl;
  refreshOnConnect?: boolean;
}

const RECONNECT_DELAY_MS = 3_000;

export function useProductEventStream({
  conversationId,
  afterSeq,
  requestOptions,
  eventsUrl = productEventsUrl,
  onEvent,
  onGap,
  refreshOnConnect = false,
}: ProductEventStreamOptions): ConnectionState {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('closed');
  const onEventRef = useRef(onEvent);
  const onGapRef = useRef(onGap);
  onEventRef.current = onEvent;
  onGapRef.current = onGap;

  useEffect(() => {
    if (!conversationId) {
      setConnectionState('closed');
      return;
    }

    let stopped = false;
    let cursor = afterSeq;
    const controller = new AbortController();

    async function consume(): Promise<void> {
      while (!stopped) {
        try {
          setConnectionState('connecting');
          if (refreshOnConnect) cursor = await onGapRef.current();
          if (stopped) return;
          await prepareProductRequest(requestOptions);
          const response = await fetch(eventsUrl(conversationId!, cursor), {
            credentials: 'include',
            headers: getProductRequestHeaders(requestOptions),
            signal: controller.signal,
          });
          if (!response.ok || !response.body) {
            throw new Error(`Event stream failed: ${response.status}`);
          }
          setConnectionState('open');
          for await (const data of readSseData(response.body)) {
            if (stopped) return;
            const event = parseProductEvent(data);
            if (event.conversation_id !== conversationId) continue;
            let disposition = classifyProductSequence(cursor, event.seq);
            if (disposition === 'ignore') continue;
            if (disposition === 'gap') {
              cursor = await onGapRef.current();
              disposition = classifyProductSequence(cursor, event.seq);
              if (disposition === 'ignore') continue;
              if (disposition === 'gap') {
                throw new Error(
                  `Event sequence gap after refresh: ${cursor} -> ${event.seq}`,
                );
              }
            }
            onEventRef.current(event);
            cursor = event.seq;
          }
        } catch (error) {
          if (stopped || controller.signal.aborted) return;
          console.error('Product event stream disconnected:', error);
        }
        setConnectionState('closed');
        await delay(RECONNECT_DELAY_MS);
      }
    }

    void consume();
    return () => {
      stopped = true;
      controller.abort();
      setConnectionState('closed');
    };
  }, [afterSeq, conversationId, requestOptions, eventsUrl, refreshOnConnect]);

  return connectionState;
}

async function* readSseData(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) yield data;
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
