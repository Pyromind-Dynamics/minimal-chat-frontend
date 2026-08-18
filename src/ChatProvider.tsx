import { useCallback, useReducer, type ReactNode } from 'react';
import {
  ChatContext,
  chatReducer,
  initialState,
} from './ChatContext';
import type { ProductEvent } from './types';

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const handleEvent = useCallback((event: ProductEvent) => {
    dispatch({ type: 'APPLY_EVENT', event });
  }, []);

  return (
    <ChatContext.Provider value={{ state, dispatch, handleEvent }}>
      {children}
    </ChatContext.Provider>
  );
}
