import { useCallback, useState } from 'react';
import { ChatProvider, useChatContext } from './ChatContext';
import { useConversationSocket } from './hooks/useConversationSocket';
import { createConversation, sendMessage } from './api';
import { ChatPanel } from './components/ChatPanel';
import { MessageInput } from './components/MessageInput';
import { StatusBar } from './components/StatusBar';

function ChatApp() {
  const { state, dispatch, handleEvent } = useChatContext();
  const [isSending, setIsSending] = useState(false);

  const { wsState } = useConversationSocket({
    conversationId: state.conversationId,
    onEvent: handleEvent,
  });

  const handleSend = useCallback(async (text: string) => {
    setIsSending(true);
    try {
      if (!state.conversationId) {
        // First message: create a new conversation with the initial message
        const info = await createConversation(text);
        dispatch({ type: 'SET_CONVERSATION_ID', id: info.id });
      } else {
        // Subsequent messages: send to existing conversation
        await sendMessage(state.conversationId, text);
      }
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setIsSending(false);
    }
  }, [state.conversationId, dispatch]);

  return (
    <div className="h-screen flex flex-col bg-white">
      <StatusBar
        wsState={wsState}
        status={state.status}
        conversationId={state.conversationId}
      />

      {state.error && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700">
          {state.error}
          <button
            onClick={() => dispatch({ type: 'SET_ERROR', error: null })}
            className="ml-2 underline"
          >
            dismiss
          </button>
        </div>
      )}

      <ChatPanel events={state.events} />

      <MessageInput
        onSend={handleSend}
        disabled={isSending || state.status === 'running'}
      />
    </div>
  );
}

function App() {
  return (
    <ChatProvider>
      <ChatApp />
    </ChatProvider>
  );
}

export default App;
