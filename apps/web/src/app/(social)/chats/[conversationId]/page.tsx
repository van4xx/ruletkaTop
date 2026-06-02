import type { Metadata } from 'next';
import { ChatThread } from '@/features/chat/chat-thread';

export const metadata: Metadata = {
  title: 'Переписка',
};

/**
 * /chats/[conversationId] — the realtime thread. `params` is async in the
 * App Router (Next 15+/16); we await it and hand the id to the client thread
 * which owns history, realtime delivery, typing and receipts.
 */
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return <ChatThread conversationId={conversationId} />;
}
