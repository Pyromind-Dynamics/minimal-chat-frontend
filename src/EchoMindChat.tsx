import { ProductPlanningChat } from './components/ProductPlanningChat';
import { createProductClient } from './productClient';
import { ECHOMIND_CONVERSATIONS_PATH } from './echomindContract';

const client = createProductClient(ECHOMIND_CONVERSATIONS_PATH);

export function EchoMindChat() {
  return (
    <ProductPlanningChat
      client={client}
      title="EchoMind Manager"
      storageNamespace="minimal-chat.echomind.v2"
    />
  );
}
