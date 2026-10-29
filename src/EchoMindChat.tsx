import { ProductPlanningChat } from './components/ProductPlanningChat';
import { createProductClient } from './productClient';

const client = createProductClient('/api/v2/echomind/conversations');

export function EchoMindChat() {
  return <ProductPlanningChat client={client} title="EchoMind Manager" storageNamespace="minimal-chat.echomind.v2" />;
}
