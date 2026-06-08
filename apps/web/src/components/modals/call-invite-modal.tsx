'use client';

/**
 * Incoming direct call invite (from a friend).
 *
 * Driven by the `call:invite` socket event (the realtime host opens this modal
 * with the payload). If the caller's nickname/avatar weren't in the payload we
 * look them up via `GET /profile/:id` for a richer card.
 *
 * Accept: we hand the call off to the roulette engine on `/video` (or `/voice`)
 * rather than emitting `call:accept` here — the engine acquires media, builds
 * the answerer RTCPeerConnection, and only THEN emits `call:accept` (so the
 * caller's offer can never arrive before our peer connection exists). We record
 * a {@link DirectCallIntent} (carrying the `callId`) and navigate; the engine
 * drains it. Decline emits `call:decline { callId }` straight away.
 */
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Mic, PhoneIncoming, PhoneOff, Video } from 'lucide-react';
import { Avatar, Button, DialogDescription, DialogHeader, DialogTitle } from '@ruletka/ui';
import { api, ApiClientError } from '@/lib/api';
import { useModal, useModalProps } from '@/lib/stores/modal-store';
import { setDirectCallIntent } from '@/lib/stores/direct-call-store';
import { emitSocketOn } from '@/features/chat/lib/use-socket';

/** Auto-decline after this long if the user doesn't respond (ms). */
const AUTO_DECLINE_MS = 30_000;

export function CallInviteModal() {
  const { close } = useModal();
  const router = useRouter();
  const t = useTranslations('chrome');
  const { callId, fromUserId, type, nickname, avatarUrl } = useModalProps<'call-invite'>();

  // Look up the caller only if we weren't handed their display info.
  const caller = useQuery({
    queryKey: ['call-invite-profile', fromUserId],
    queryFn: async () => {
      try {
        return await api.profile.byId(fromUserId);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: !nickname && Boolean(fromUserId),
    staleTime: 60_000,
  });

  const displayName = nickname ?? caller.data?.nickname ?? t('modals.callInvite.fallbackName');
  const displayAvatar = avatarUrl ?? caller.data?.avatarUrl ?? null;
  const isVideo = type === 'video';

  function decline() {
    // Calls ride the primary /mm socket (alongside matchmaking + notifications).
    emitSocketOn('/mm', 'call:decline', { callId });
    close();
  }
  function accept() {
    // Hand the call off to the roulette engine: record the intent (with the
    // callId) and navigate to the matching stage. The engine builds the answerer
    // PeerConnection THEN emits `call:accept` (so the caller's offer can't beat
    // our peer connection into existence). We do NOT emit `call:accept` here.
    setDirectCallIntent({ role: 'callee', peerUserId: fromUserId, type, callId });
    close();
    router.push(type === 'video' ? '/video' : '/voice');
  }

  // Auto-decline on timeout so a missed call doesn't hang forever.
  const declineRef = useRef(decline);
  declineRef.current = decline;
  useEffect(() => {
    const t = setTimeout(() => declineRef.current(), AUTO_DECLINE_MS);
    return () => clearTimeout(t);
  }, [callId]);

  return (
    <>
      <DialogHeader className="items-center text-center">
        <span className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/50 px-2.5 py-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
          {isVideo ? <Video className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          {isVideo ? t('modals.callInvite.video') : t('modals.callInvite.voice')}
        </span>
        <DialogTitle className="sr-only">
          {t('modals.callInvite.incomingTitle', { name: displayName })}
        </DialogTitle>
      </DialogHeader>

      <div className="flex flex-col items-center gap-4 py-2">
        {/* Pulsing avatar ring to signal an incoming call. */}
        <span className="relative inline-flex">
          <span
            aria-hidden="true"
            className="absolute -inset-2 rounded-full bg-[var(--color-neon-violet)]/30 blur-md motion-safe:animate-ping"
          />
          <Avatar size="xl" src={displayAvatar || undefined} alt={displayName} ring="aurora" />
        </span>

        <div className="text-center">
          <p className="font-display text-xl font-bold text-foreground">{displayName}</p>
          <DialogDescription className="mt-0.5">
            {isVideo ? t('modals.callInvite.invitesVideo') : t('modals.callInvite.invitesVoice')}
          </DialogDescription>
        </div>

        <div className="mt-2 flex w-full items-center justify-center gap-6">
          <div className="flex flex-col items-center gap-1.5">
            <Button
              type="button"
              variant="danger"
              size="lg"
              className="size-14 rounded-full p-0"
              aria-label={t('modals.callInvite.decline')}
              onClick={decline}
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
            <span className="text-xs text-muted-foreground">{t('modals.callInvite.decline')}</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="size-14 rounded-full p-0"
              aria-label={t('modals.callInvite.accept')}
              onClick={accept}
            >
              <PhoneIncoming className="h-6 w-6" />
            </Button>
            <span className="text-xs text-muted-foreground">{t('modals.callInvite.accept')}</span>
          </div>
        </div>
      </div>
    </>
  );
}
