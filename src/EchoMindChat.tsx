import { ProductPlanningChat } from './components/ProductPlanningChat';
import { createEchoMindChatClient, createProductClient } from './productClient';
import { ECHOMIND_CONVERSATIONS_PATH } from './echomindContract';

const client = createProductClient(ECHOMIND_CONVERSATIONS_PATH);
const chatClient = createEchoMindChatClient(ECHOMIND_CONVERSATIONS_PATH);

export function EchoMindChat() {
  return (
    <ProductPlanningChat
      client={client}
      chatClient={chatClient}
      title="EchoMind"
      storageNamespace="minimal-chat.echomind.v2"
    />
  );
}
