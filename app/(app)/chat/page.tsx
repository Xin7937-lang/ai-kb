// /chat — AI chat over personal notes.
// Server component: pre-fetches the conversation list for the sidebar,
// then delegates the interactive UI to ChatPageClient.

import { listConversations } from '@/lib/chat/queries';
import { ChatPageClient } from './chat-page-client';

export const dynamic = 'force-dynamic';

export default function ChatPage() {
  const conversations = listConversations();

  return <ChatPageClient initialConversations={conversations} />;
}
