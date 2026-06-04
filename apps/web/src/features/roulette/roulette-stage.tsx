'use client';

/**
 * The full roulette experience for a given mode (video|voice). Owns dialog
 * visibility and wires the {@link useRoulette} engine to all the chrome:
 * filters, controls, peer overlay, gift/report/block dialogs, in-call chat, and
 * the stage layout.
 *
 * VIDEO has two switchable layouts (persisted via {@link useRouletteLayoutStore}):
 *   - `'standard'` — remote video full-bleed + draggable local PiP + floating
 *     chat/controls (the classic stage).
 *   - `'grid'` — a 2×2 grid (peer / me / square controls / docked per-call chat),
 *     rendered by {@link RouletteGrid}.
 * Either layout can also go FULLSCREEN: the stage element itself enters the
 * browser Fullscreen API (or a CSS faux-fullscreen fallback), the real
 * SiteHeader drops away, and a slim auto-hiding {@link FullscreenBar} restores
 * the brand mark + layout switcher inside the stage.
 *
 * VOICE keeps the classic avatar/equalizer layout (no grid); only the
 * fullscreen toggle is offered there.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import type { MatchType } from '@ruletka/shared-types';
import { toast } from '@ruletka/ui';

import { useRoulette } from './use-roulette';
import { useAuthToken } from '@/hooks/roulette/use-auth-token';
import { useAddFriend } from '@/hooks/roulette/use-roulette-api';
import { useSharedInterests } from '@/hooks/roulette/use-shared-interests';
import { useLocalScreening, useModerationAction } from '@/features/moderation';
import { FiltersDialog } from '@/components/roulette/filters-dialog';
import { CallControls } from '@/components/roulette/call-controls';
import { CallOverlay } from '@/components/roulette/call-overlay';
import { CallChat } from '@/components/roulette/call-chat';
import { GiftPicker } from '@/components/roulette/gift-picker';
import { ReportDialog } from '@/components/roulette/report-dialog';
import { BlockConfirmDialog } from '@/components/roulette/block-confirm-dialog';
import { VideoTile } from '@/components/roulette/video-tile';
import { VoiceVisualizer } from '@/components/roulette/voice-visualizer';
import { RouletteGrid } from '@/components/roulette/roulette-grid';
import { VideoLayoutSwitcher } from '@/components/roulette/video-layout-switcher';
import { FullscreenBar } from '@/components/roulette/fullscreen-bar';
import {
  EndedScreen,
  ErrorScreen,
  IdleScreen,
  ReconnectingScreen,
  SearchingScreen,
  SignInScreen,
} from '@/components/roulette/status-screens';
import { useLayoutMode, useLayoutHydrated } from '@/lib/stores/roulette-layout-store';
import { COUNTRY_BY_CODE, codeToFlag } from '@ruletka/ui';
import { cn } from '@/lib/cn';

/** Vendor-prefixed Fullscreen API surface (Safari) on top of the std types. */
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
};

/** Idle delay before the fullscreen chrome (bar + cursor) fades out. */
const FULLSCREEN_IDLE_MS = 2500;

export function RouletteStage({ type }: { type: MatchType }) {
  const t = useTranslations('roulette');
  const isVideo = type === 'video';
  const { token, ready, isPremium } = useAuthToken();
  const r = useRoulette({ type, token });
  const addFriend = useAddFriend();

  // ── Layout (video only) ──────────────────────────────────────────────
  // Persisted standard-vs-grid choice; `hydrated` gates an SSR/CSR flash by
  // pinning 'standard' on the server and until localStorage rehydrates.
  const layoutMode = useLayoutMode();
  const layoutHydrated = useLayoutHydrated();
  const gridMode = isVideo && layoutHydrated && layoutMode === 'grid';

  // Fullscreen is ephemeral (the Fullscreen API needs a user gesture, so we
  // never persist/auto-enter it). `fauxRef` tracks the CSS fallback used when
  // element-fullscreen is unavailable (e.g. iOS Safari) so exit/Esc still work.
  const stageRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const fauxRef = useRef(false);

  // ── Trust & Safety ────────────────────────────────────────────────────
  // On-device NSFW screening of the LOCAL camera (video calls only). On a
  // violation it flags the preview (we blur + cut the local tile) and reports
  // an evidence frame to the server, which owns escalation. Degrades to a
  // silent no-op if the model can't load — never breaks the call.
  const screening = useLocalScreening({
    stream: r.localStream,
    matchId: r.roomId,
    enabled: isVideo,
    onViolation: () =>
      toast.warning(t('screening.hiddenTitle'), {
        description: t('screening.hiddenDescription'),
        duration: 6000,
      }),
  });

  // When screening flags the local feed, stop broadcasting video to the peer
  // (disable the local video track) so the offending frames never reach them.
  useEffect(() => {
    const stream = r.localStream;
    if (!isVideo || !stream) return;
    if (!screening.flagged) return;
    const tracks = stream.getVideoTracks();
    tracks.forEach((t) => (t.enabled = false));
    return () => {
      // On un-flag (cooldown elapsed) restore video unless the user muted it.
      if (!r.cameraOff) tracks.forEach((t) => (t.enabled = true));
    };
  }, [screening.flagged, isVideo, r.localStream, r.cameraOff]);

  // Handle server-forced moderation actions (warn / kick / ban). A kick or ban
  // tears the call down via r.stop; a ban additionally signs the user out.
  useModerationAction({ onKick: r.stop });

  const [giftOpen, setGiftOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [longWait, setLongWait] = useState(false);

  // Surface a "long wait" hint when we stay in searching with no position.
  useEffect(() => {
    if (r.status !== 'searching') {
      setLongWait(false);
      return;
    }
    const id = setTimeout(() => setLongWait(true), 12_000);
    return () => clearTimeout(id);
  }, [r.status, r.roomId]);

  // Pre-warm camera/mic + ICE servers as soon as we're authed and idle, so the
  // first Start connects instantly. Best-effort + silent (see useRoulette).
  const prewarm = r.prewarm;
  useEffect(() => {
    if (token && r.status === 'idle') prewarm();
  }, [token, r.status, prewarm]);

  // ── Fullscreen ────────────────────────────────────────────────────────
  // Keep `fullscreen` in sync with the real API so pressing Esc (or the OS
  // chrome) updates our UI. Only relevant when NOT in the faux fallback.
  useEffect(() => {
    const onChange = () => {
      if (fauxRef.current) return;
      setFullscreen(document.fullscreenElement === stageRef.current);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current as FullscreenElement | null;
    const doc = document as FullscreenDocument;

    // ── Exit ──
    if (fullscreen) {
      if (fauxRef.current) {
        fauxRef.current = false;
        setFullscreen(false);
        return;
      }
      if (doc.exitFullscreen) void doc.exitFullscreen();
      else if (doc.webkitExitFullscreen) void doc.webkitExitFullscreen();
      // `fullscreenchange` will flip the flag; flip eagerly too for safety.
      setFullscreen(false);
      return;
    }

    // ── Enter ──
    if (!el) return;
    if (el.requestFullscreen) {
      // The change listener flips `fullscreen`; if it rejects (e.g. iOS Safari
      // element FS is unsupported), fall back to CSS faux-fullscreen.
      void Promise.resolve(el.requestFullscreen()).catch(() => {
        fauxRef.current = true;
        setFullscreen(true);
      });
    } else if (el.webkitRequestFullscreen) {
      void Promise.resolve(el.webkitRequestFullscreen()).catch(() => {
        fauxRef.current = true;
        setFullscreen(true);
      });
    } else {
      // No element-fullscreen support → faux-fullscreen.
      fauxRef.current = true;
      setFullscreen(true);
    }
  }, [fullscreen]);

  // In the faux (CSS) fullscreen there's no native Esc-to-exit, so wire it up.
  useEffect(() => {
    if (!fullscreen || !fauxRef.current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        fauxRef.current = false;
        setFullscreen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // ── Fullscreen chrome auto-hide ──────────────────────────────────────
  // Player-style behaviour: the FullscreenBar + cursor show on entry, then fade
  // after an idle period; any pointer/key activity over the stage reveals them.
  const [chromeVisible, setChromeVisible] = useState(true);
  useEffect(() => {
    if (!fullscreen) {
      setChromeVisible(true);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const reveal = () => {
      setChromeVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => setChromeVisible(false), FULLSCREEN_IDLE_MS);
    };
    reveal(); // visible on entry, then start the idle countdown
    const node = stageRef.current;
    node?.addEventListener('pointermove', reveal);
    node?.addEventListener('pointerdown', reveal);
    window.addEventListener('keydown', reveal);
    return () => {
      clearTimeout(timer);
      node?.removeEventListener('pointermove', reveal);
      node?.removeEventListener('pointerdown', reveal);
      window.removeEventListener('keydown', reveal);
    };
  }, [fullscreen]);

  const peer = r.peer;
  // Interests shared with the matched peer (for the in-call badge). Derived from
  // the existing profile fetches; safely empty when the peer profile is hidden
  // or the viewer has no interests. See useSharedInterests.
  const peerSharedInterests = useSharedInterests(peer?.userId);
  const inCall =
    r.status === 'connecting' || r.status === 'connected' || r.status === 'reconnecting';
  const hasPeer = Boolean(peer) && inCall;
  // Keep the media stage mounted during a transient reconnect — the remote
  // track may still be live (P2P), and remounting it would cause a flash.
  const showStage = inCall;

  function handleAddFriend() {
    if (!peer) return;
    addFriend.mutate(
      { recipientId: peer.userId },
      {
        onSuccess: () => toast.success(t('friend.requestSent', { name: peer.nickname })),
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : t('friend.requestError')),
      },
    );
  }

  // After reporting/blocking we skip to the next peer.
  const skipNext = () => r.next();

  // ── Not authenticated → sign-in prompt ──
  if (ready && !token && r.status === 'idle') {
    return (
      <StageFrame isVideo={isVideo} fullscreen={false} containerRef={stageRef}>
        <div className="grid h-full place-items-center">
          <SignInScreen isVideo={isVideo} />
        </div>
      </StageFrame>
    );
  }

  const peerSubtitle = peer
    ? t('peerSubtitle', {
        age: peer.age,
        flag: codeToFlag(peer.country),
        country: COUNTRY_BY_CODE.get(peer.country)?.name ?? peer.country,
      })
    : '';

  // Top-right controls cluster (filters + layout switcher). Shown only when NOT
  // fullscreen; in fullscreen the FullscreenBar carries the switcher instead.
  const topRightCluster = !fullscreen && (
    <div className="absolute right-3 top-3 z-30 flex items-start gap-2 sm:right-4 sm:top-4">
      <VideoLayoutSwitcher
        isVideo={isVideo}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
      />
      {/* During an active call the overlay sits top-left, so nudge the cluster
          down a touch on small screens when a peer is present. */}
      <div className={cn(hasPeer && isVideo && 'mt-16 sm:mt-0')}>
        <FiltersDialog value={r.filters} onApply={r.setFilters} isPremium={isPremium} />
      </div>
    </div>
  );

  // Self-contained gift/report/block dialogs — shared by both layouts.
  const dialogs = peer && (
    <>
      <GiftPicker
        open={giftOpen}
        onOpenChange={setGiftOpen}
        toUserId={peer.userId}
        peerName={peer.nickname}
        isPremium={isPremium}
      />
      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        againstUserId={peer.userId}
        peerName={peer.nickname}
        onReported={skipNext}
      />
      <BlockConfirmDialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        blockedUserId={peer.userId}
        peerName={peer.nickname}
        onBlocked={skipNext}
      />
    </>
  );

  // ── GRID layout (video only) ──────────────────────────────────────────
  if (gridMode) {
    return (
      <StageFrame
        isVideo={isVideo}
        fullscreen={fullscreen}
        containerRef={stageRef}
        cursorHidden={fullscreen && !chromeVisible}
      >
        <RouletteGrid
          r={r}
          peer={peer}
          hasPeer={hasPeer}
          showStage={showStage}
          longWait={longWait}
          flagged={screening.flagged}
          sharedInterests={peerSharedInterests}
          onGift={() => setGiftOpen(true)}
          onAddFriend={handleAddFriend}
          onReport={() => setReportOpen(true)}
          onBlock={() => setBlockOpen(true)}
        />

        {topRightCluster}

        {fullscreen && (
          <FullscreenBar isVideo={isVideo} onExit={toggleFullscreen} visible={chromeVisible} />
        )}

        {dialogs}
      </StageFrame>
    );
  }

  // ── STANDARD layout (classic stage; also used by voice) ───────────────
  return (
    <StageFrame
      isVideo={isVideo}
      fullscreen={fullscreen}
      containerRef={stageRef}
      cursorHidden={fullscreen && !chromeVisible}
    >
      {/* ── Media layer ─────────────────────────────────────────── */}
      <div className="absolute inset-0">
        {isVideo
          ? // Only mount the remote tile during a match; idle/searching show the
            // ambient backdrop + a status screen instead (no double placeholder).
            showStage && (
              <VideoTile
                stream={r.remoteStream}
                muted={false}
                placeholderName={peer?.nickname}
                placeholderAvatar={peer?.avatarUrl}
                fit="cover"
              />
            )
          : showStage &&
            peer && (
              <div className="grid h-full place-items-center px-6">
                <VoiceVisualizer
                  stream={r.remoteStream}
                  name={peer.nickname}
                  avatarUrl={peer.avatarUrl}
                  subtitle={peerSubtitle}
                  tone="peer"
                />
              </div>
            )}
      </div>

      {/* ── Reconnecting scrim (kept over the live stage) ───────── */}
      <AnimatePresence>
        {r.status === 'reconnecting' && (
          <motion.div
            key="reconnecting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-[25] grid place-items-center bg-black/45 backdrop-blur-[2px]"
            role="status"
            aria-live="polite"
          >
            <ReconnectingScreen attempt={r.reconnectAttempt} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Non-stage status screens ────────────────────────────── */}
      <AnimatePresence mode="wait">
        {!showStage && (
          <motion.div
            key={r.status}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 grid place-items-center"
          >
            {r.status === 'idle' || r.status === 'requesting' ? (
              <IdleScreen isVideo={isVideo} />
            ) : r.status === 'searching' ? (
              <SearchingScreen positionHint={r.positionHint} longWait={longWait} />
            ) : r.status === 'ended' ? (
              <EndedScreen />
            ) : r.status === 'error' && r.error ? (
              <ErrorScreen error={r.error} onRetry={r.start} />
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Peer overlay (top) ──────────────────────────────────── */}
      {hasPeer && peer && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-start p-3 sm:p-4">
          <CallOverlay
            peer={peer}
            status={r.status}
            quality={r.quality}
            sharedInterests={peerSharedInterests}
            compact={!isVideo}
            className="max-w-[20rem]"
          />
        </div>
      )}

      {/* ── Local PiP (video only) ──────────────────────────────── */}
      {isVideo && r.localStream && r.status !== 'idle' && r.status !== 'error' && (
        <motion.div
          drag
          dragMomentum={false}
          dragElastic={0.12}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className={cn(
            'absolute bottom-24 right-3 z-20 h-40 w-28 cursor-grab overflow-hidden rounded-2xl',
            'border border-border/70 shadow-xl active:cursor-grabbing sm:bottom-28 sm:right-5 sm:h-48 sm:w-36',
          )}
        >
          <VideoTile
            stream={r.localStream}
            muted
            mirror
            cameraOff={r.cameraOff}
            flagged={screening.flagged}
            placeholderName={t('self')}
            fit="cover"
          />
          <span className="absolute bottom-1 left-1 rounded-md bg-black/50 px-1.5 py-0.5 text-[0.625rem] font-medium text-white">
            {t('self')}
          </span>
        </motion.div>
      )}

      {/* ── Local self mini-visualizer (voice only) ─────────────── */}
      {!isVideo && r.localStream && showStage && (
        <div className="pointer-events-none absolute bottom-28 right-3 z-20 sm:right-6">
          <div className="glass-panel rounded-2xl px-3 py-2">
            <VoiceVisualizer
              stream={r.localStream}
              name={t('self')}
              tone="local"
              compact
              className="w-32"
            />
          </div>
        </div>
      )}

      {/* ── In-call chat ────────────────────────────────────────── */}
      <div className="pointer-events-none absolute bottom-24 left-3 z-30 sm:bottom-28 sm:left-6">
        <CallChat
          open={r.chatOpen && hasPeer}
          onClose={() => r.setChatOpen(false)}
          messages={r.chatMessages}
          onSend={r.sendChatMessage}
          peerName={peer?.nickname ?? t('peerFallback')}
        />
      </div>

      {/* ── Top-right: layout switcher + filters ─────────────────── */}
      {topRightCluster}

      {/* ── Bottom control bar ──────────────────────────────────── */}
      <div className="absolute inset-x-0 bottom-0 z-30 flex justify-center p-3 sm:p-5">
        <CallControls
          status={r.status}
          isVideo={isVideo}
          micMuted={r.micMuted}
          cameraOff={r.cameraOff}
          isStarting={r.isStarting}
          hasPeer={hasPeer}
          chatOpen={r.chatOpen}
          onStart={r.start}
          onNext={r.next}
          onStop={r.stop}
          onToggleMic={r.toggleMic}
          onToggleCamera={r.toggleCamera}
          onGift={() => setGiftOpen(true)}
          onAddFriend={handleAddFriend}
          onToggleChat={() => r.setChatOpen(!r.chatOpen)}
          onReport={() => setReportOpen(true)}
          onBlock={() => setBlockOpen(true)}
        />
      </div>

      {/* ── Fullscreen chrome (slim auto-hiding bar) ─────────────── */}
      {fullscreen && (
        <FullscreenBar isVideo={isVideo} onExit={toggleFullscreen} visible={chromeVisible} />
      )}

      {/* ── Dialogs (self-contained) ────────────────────────────── */}
      {dialogs}
    </StageFrame>
  );
}

/**
 * The stage canvas: an atmospheric, rounded glass arena that fills the viewport
 * height under the sticky header. Provides the dark gradient backdrop both
 * modes share.
 *
 * When `fullscreen`, the element becomes the Fullscreen API target (or, in the
 * CSS faux-fullscreen fallback, a fixed full-viewport overlay): it drops its
 * rounded frame/margins and fills the screen, while the `absolute`/grid children
 * reflow automatically — so the grid and standard layouts work identically
 * embedded and fullscreen with no extra code. The cursor hides while the
 * fullscreen chrome is faded out.
 */
function StageFrame({
  isVideo,
  fullscreen,
  containerRef,
  cursorHidden = false,
  children,
}: {
  isVideo: boolean;
  fullscreen: boolean;
  containerRef: React.Ref<HTMLDivElement>;
  /** Hide the cursor (fullscreen idle) along with the chrome. */
  cursorHidden?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        !fullscreen && 'mx-auto w-full max-w-6xl px-2 py-3 sm:px-4 sm:py-5',
      )}
    >
      <div
        ref={containerRef}
        className={cn(
          'relative isolate overflow-hidden bg-[#07070b]',
          fullscreen
            ? 'fixed inset-0 z-50 h-screen w-screen rounded-none border-0'
            : 'rounded-3xl border border-border/60 h-[calc(100dvh-5.5rem)] min-h-[30rem] sm:h-[calc(100dvh-7rem)]',
          cursorHidden && 'cursor-none',
        )}
      >
        {/* Ambient backdrop for non-video / placeholder areas. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div
            className={cn(
              'absolute -top-32 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full blur-3xl',
              isVideo ? 'opacity-20' : 'opacity-30',
              'bg-[radial-gradient(circle,var(--color-neon-violet),transparent_60%)]',
            )}
          />
          <div className="absolute -bottom-24 -right-16 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan),transparent_60%)] opacity-20 blur-3xl" />
          <div className="absolute -bottom-32 -left-16 h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-magenta),transparent_60%)] opacity-15 blur-3xl" />
        </div>
        {children}
      </div>
    </div>
  );
}
