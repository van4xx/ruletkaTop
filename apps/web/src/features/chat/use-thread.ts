'use client';

/**
 * The realtime message-thread engine for a single conversation.
 *
 * History  : GET /conversations/:id/messages?cursor&limit (newest-first pages)
 *            surfaced as an infinite query; flattened + reversed to chronological
 *            order for rendering, with "load older" at the top.
 * Send     : optimistic — append a pending bubble immediately, emit `chat:message`
 *            over the socket, and reconcile when the server echoes the persisted
 *            Message back (also via `chat:message`). A REST `POST /messages`
 *            fallback covers the case where the socket isn't connected.
 * Receive  : incoming `chat:message` for this conversation is appended live.
 * Typing   : emits `chat:typing` (debounced stop) and exposes the peer's state.
 * Receipts : marks the newest inbound message read (`chat:read`) and reflects
 *            read state on outbound bubbles (sent → read ticks).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { Message } from '@ruletka/shared-types';

import { api } from '@/lib/api';
import { emitSocket, useSocket, useSocketEvent } from './lib/use-socket';
import { chatKeys } from './use-conversations';

interface MessagePage {
  items: Message[];
  nextCursor: string | null;
  hasMore: boolean;
}

const PAGE_SIZE = 30;

/** A message augmented with client-side delivery state for optimistic UI. */
export interface ChatMessage extends Message {
  /** Local-only: the message is awaiting server confirmation. */
  pending?: boolean;
  /** Local-only: the optimistic send failed. */
  failed?: boolean;
  /** Local correlation id for optimistic bubbles (before the real id lands). */
  clientId?: string;
}

export interface UseThreadResult {
  messages: ChatMessage[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  hasMore: boolean;
  loadOlder: () => void;
  isLoadingOlder: boolean;
  send: (content: string) => void;
  retry: (message: ChatMessage) => void;
  peerTyping: boolean;
  notifyTyping: () => void;
}

export function useThread(conversationId: string, selfId: string | null): UseThreadResult {
  const qc = useQueryClient();
  const socket = useSocket();

  // Optimistic + locally-received messages layered on top of fetched history.
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [peerTyping, setPeerTyping] = useState(false);

  const query = useInfiniteQuery<MessagePage>({
    queryKey: chatKeys.messages(conversationId),
    queryFn: ({ pageParam }) =>
      api.request<MessagePage>(`/conversations/${conversationId}/messages`, {
        query: { cursor: pageParam as string | undefined, limit: PAGE_SIZE },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
    staleTime: 10_000,
  });

  // Fetched history, flattened newest→oldest then reversed to chronological.
  const history = useMemo<Message[]>(() => {
    const pages = (query.data as InfiniteData<MessagePage> | undefined)?.pages ?? [];
    const newestFirst = pages.flatMap((p) => p.items);
    return [...newestFirst].reverse();
  }, [query.data]);

  // Merge history + local, de-duplicated by id, chronological.
  const messages = useMemo<ChatMessage[]>(() => {
    const byId = new Map<string, ChatMessage>();
    for (const m of history) byId.set(m.id, m);
    for (const m of localMessages) {
      // Local entries (optimistic sends + live-received messages) layer over
      // fetched history; de-duped by id. The socket handler below removes the
      // optimistic twin once the server echoes the persisted message back.
      byId.set(m.id, { ...byId.get(m.id), ...m });
    }
    return Array.from(byId.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [history, localMessages]);

  // ── Receive live messages for THIS conversation ──
  useSocketEvent('chat:message', (m: Message) => {
    if (m.conversationId !== conversationId) return;
    setLocalMessages((prev) => {
      // Reconcile an optimistic bubble from us: drop the matching pending twin.
      if (selfId && m.senderId === selfId) {
        const withoutPendingTwin = prev.filter((p) => !(p.pending && p.content === m.content));
        if (withoutPendingTwin.some((p) => p.id === m.id)) return withoutPendingTwin;
        return [...withoutPendingTwin, m];
      }
      if (prev.some((p) => p.id === m.id)) return prev;
      return [...prev, m];
    });
  });

  // ── Typing indicator from the peer ──
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useSocketEvent('chat:typing', (p) => {
    if (p.conversationId !== conversationId) return;
    setPeerTyping(p.isTyping);
    if (p.isTyping) {
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      // Auto-clear if no "stopped typing" arrives.
      typingTimeout.current = setTimeout(() => setPeerTyping(false), 4000);
    }
  });

  // ── Read receipts: reflect peer reading our messages ──
  useSocketEvent('chat:read', (p) => {
    if (p.conversationId !== conversationId) return;
    const readAt = new Date().toISOString();
    // Mark our messages up to-and-including p.messageId as read.
    const stamp = (m: ChatMessage): ChatMessage =>
      m.senderId === selfId && !m.readAt ? { ...m, readAt } : m;
    setLocalMessages((prev) => prev.map(stamp));
    // Also patch fetched history in the cache so re-renders keep the read state.
    qc.setQueryData<InfiniteData<MessagePage>>(chatKeys.messages(conversationId), (data) => {
      if (!data) return data;
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.map((m) => (m.senderId === selfId && !m.readAt ? { ...m, readAt } : m)),
        })),
      };
    });
  });

  // ── Mark the newest INBOUND message as read whenever the thread updates ──
  const lastReadId = useRef<string | null>(null);
  useEffect(() => {
    const lastInbound = [...messages].reverse().find((m) => m.senderId !== selfId && !m.pending);
    if (lastInbound && lastInbound.id !== lastReadId.current && !lastInbound.readAt) {
      lastReadId.current = lastInbound.id;
      emitSocket('chat:read', { conversationId, messageId: lastInbound.id });
      // Optimistically zero the unread badge in the inbox.
      qc.setQueryData<import('@ruletka/shared-types').Conversation[]>(
        chatKeys.conversations(),
        (prev) =>
          prev?.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)) ?? prev,
      );
    }
  }, [messages, selfId, conversationId, qc]);

  // ── Sending ──
  const send = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const clientId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: ChatMessage = {
        id: clientId,
        clientId,
        conversationId,
        senderId: selfId ?? 'me',
        type: 'text',
        content: trimmed,
        readAt: null,
        createdAt: new Date().toISOString(),
        pending: true,
      };
      setLocalMessages((prev) => [...prev, optimistic]);

      const finalize = (ok: boolean, server?: Message) => {
        setLocalMessages((prev) =>
          prev.map((m) => {
            if (m.clientId !== clientId) return m;
            if (ok && server) return { ...server };
            if (ok) return { ...m, pending: false };
            return { ...m, pending: false, failed: true };
          }),
        );
      };

      if (socket.connected) {
        // Realtime path: the gateway will echo the persisted Message back via
        // `chat:message`, which reconciles the optimistic twin above. We still
        // clear the pending flag after a short grace window as a safety net.
        emitSocket('chat:message', { conversationId, content: trimmed });
        window.setTimeout(() => {
          setLocalMessages((prev) =>
            prev.map((m) => (m.clientId === clientId && m.pending ? { ...m, pending: false } : m)),
          );
        }, 6000);
      } else {
        // Fallback: persist over REST and append the returned Message.
        api
          .request<Message>('/messages', {
            method: 'POST',
            json: { conversationId, content: trimmed },
          })
          .then((server) => finalize(true, server))
          .catch(() => finalize(false));
      }
    },
    [conversationId, selfId, socket],
  );

  const retry = useCallback(
    (message: ChatMessage) => {
      // Drop the failed bubble and re-send its content.
      setLocalMessages((prev) => prev.filter((m) => m.clientId !== message.clientId));
      send(message.content);
    },
    [send],
  );

  // ── Outbound typing signal (throttled start, debounced stop) ──
  const typingActive = useRef(false);
  const stopTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifyTyping = useCallback(() => {
    if (!typingActive.current) {
      typingActive.current = true;
      emitSocket('chat:typing', { conversationId, isTyping: true });
    }
    if (stopTypingTimer.current) clearTimeout(stopTypingTimer.current);
    stopTypingTimer.current = setTimeout(() => {
      typingActive.current = false;
      emitSocket('chat:typing', { conversationId, isTyping: false });
    }, 1800);
  }, [conversationId]);

  // Reset local state when switching conversations + tell peer we stopped.
  useEffect(() => {
    return () => {
      if (typingActive.current) {
        emitSocket('chat:typing', { conversationId, isTyping: false });
        typingActive.current = false;
      }
      if (stopTypingTimer.current) clearTimeout(stopTypingTimer.current);
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
    };
  }, [conversationId]);

  // Clear locally-held messages when the conversation id changes.
  useEffect(() => {
    setLocalMessages([]);
    setPeerTyping(false);
    lastReadId.current = null;
  }, [conversationId]);

  return {
    messages,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
    hasMore: Boolean(query.hasNextPage),
    loadOlder: () => void query.fetchNextPage(),
    isLoadingOlder: query.isFetchingNextPage,
    send,
    retry,
    peerTyping,
    notifyTyping,
  };
}
