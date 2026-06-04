'use client';

/**
 * The 2×2 GRID layout for the video roulette — an alternative to the classic
 * full-bleed-remote + floating-chrome stage. Fills the stage and reflows
 * identically whether embedded or fullscreen (every cell is a flex/grid child,
 * no absolute media), so a single render path covers both.
 *
 * Cells:
 *   top-left     PEER (remote video) + a compact identity chip
 *   top-right    ME (local video, mirrored) + a "You" tag
 *   bottom-left  CONTROLS — big square glass tiles (mic/cam/gift/…/Start·Stop)
 *   bottom-right CHAT — the existing per-call P2P text chat, docked
 *
 * It owns NO engine state: it renders {@link useRoulette}'s streams/chat and
 * calls the same handlers the floating {@link CallControls} use. Non-connected
 * states are surfaced as a status overlay across the whole grid (the four cells
 * only populate once a peer is present).
 */
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Flag,
  Gift,
  Mic,
  MicOff,
  PhoneOff,
  Play,
  SkipForward,
  UserPlus,
  UserX,
  Video,
  VideoOff,
} from 'lucide-react';
import type { PeerInfo } from '@ruletka/shared-types';
import { VideoTile } from './video-tile';
import { CallOverlay } from './call-overlay';
import { CallChat } from './call-chat';
import { GridControlButton } from './grid-control-button';
import {
  EndedScreen,
  ErrorScreen,
  IdleScreen,
  ReconnectingScreen,
  SearchingScreen,
} from './status-screens';
import type { UseRouletteResult } from '@/features/roulette/types';
import { cn } from '@/lib/cn';

export interface RouletteGridProps {
  r: UseRouletteResult;
  peer: PeerInfo | null;
  hasPeer: boolean;
  /** True while a peer connection is up (connecting/connected/reconnecting). */
  showStage: boolean;
  longWait: boolean;
  /** On-device screening flagged the local feed. */
  flagged: boolean;
  /** Interests shared with the peer (for the identity chip). */
  sharedInterests: readonly string[];
  onGift: () => void;
  onAddFriend: () => void;
  onReport: () => void;
  onBlock: () => void;
}

/** A rounded glass cell wrapper that clips its contents. */
function Cell({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'relative min-h-0 min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-black/40',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function RouletteGrid({
  r,
  peer,
  hasPeer,
  showStage,
  longWait,
  flagged,
  sharedInterests,
  onGift,
  onAddFriend,
  onReport,
  onBlock,
}: RouletteGridProps) {
  const t = useTranslations('roulette');

  const idle = r.status === 'idle' || r.status === 'error';
  const active = !idle; // session running (searching/connecting/connected/ended)

  return (
    <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-2 p-2 sm:gap-3 sm:p-3">
      {/* ── Top-left: PEER (remote) ─────────────────────────────── */}
      <Cell>
        {showStage ? (
          <VideoTile
            stream={r.remoteStream}
            muted={false}
            placeholderName={peer?.nickname}
            placeholderAvatar={peer?.avatarUrl}
            fit="cover"
          />
        ) : (
          <div className="grid h-full place-items-center bg-[radial-gradient(circle_at_center,color-mix(in_oklch,var(--color-neon-violet)_14%,transparent),transparent_70%)]">
            <span className="text-xs text-muted-foreground">{t('grid.waitingForPartner')}</span>
          </div>
        )}
        {hasPeer && peer && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-start p-2">
            <CallOverlay
              peer={peer}
              status={r.status}
              quality={r.quality}
              sharedInterests={sharedInterests}
              compact
              className="max-w-full"
            />
          </div>
        )}
      </Cell>

      {/* ── Top-right: ME (local) ───────────────────────────────── */}
      <Cell>
        {r.localStream ? (
          <VideoTile
            stream={r.localStream}
            muted
            mirror
            cameraOff={r.cameraOff}
            flagged={flagged}
            placeholderName={t('self')}
            fit="cover"
          />
        ) : (
          <div className="grid h-full place-items-center">
            <span className="text-xs text-muted-foreground">{t('grid.cameraIdle')}</span>
          </div>
        )}
        <span className="absolute bottom-2 left-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[0.625rem] font-medium text-white">
          {t('layout.you')}
        </span>
      </Cell>

      {/* ── Bottom-left: CONTROLS (square tiles) ────────────────── */}
      <Cell className="glass-panel bg-transparent">
        <div className="grid h-full grid-cols-3 content-center gap-2 overflow-y-auto p-2 sm:gap-2.5 sm:p-3">
          {/* Primary: Start when idle, otherwise Next. */}
          {idle ? (
            <GridControlButton
              label={t('controls.start')}
              icon={<Play />}
              primary
              onClick={r.start}
              disabled={r.isStarting}
            />
          ) : (
            <GridControlButton
              label={t('controls.next')}
              icon={<SkipForward />}
              primary
              onClick={r.next}
            />
          )}

          {/* Mic — always available during a session. */}
          <GridControlButton
            label={r.micMuted ? t('controls.micOn') : t('controls.micOff')}
            icon={r.micMuted ? <MicOff /> : <Mic />}
            danger={r.micMuted}
            pressed={r.micMuted}
            onClick={r.toggleMic}
            disabled={!active}
          />

          {/* Camera (video only — the grid is video-only). */}
          <GridControlButton
            label={r.cameraOff ? t('controls.cameraOn') : t('controls.cameraOff')}
            icon={r.cameraOff ? <VideoOff /> : <Video />}
            danger={r.cameraOff}
            pressed={r.cameraOff}
            onClick={r.toggleCamera}
            disabled={!active}
          />

          {/* Social actions — gated on an actual peer. */}
          <GridControlButton
            label={t('controls.gift')}
            icon={<Gift />}
            onClick={onGift}
            disabled={!hasPeer}
          />
          <GridControlButton
            label={t('controls.addFriend')}
            icon={<UserPlus />}
            onClick={onAddFriend}
            disabled={!hasPeer}
          />
          <GridControlButton
            label={t('controls.report')}
            icon={<Flag />}
            onClick={onReport}
            disabled={!hasPeer}
          />
          <GridControlButton
            label={t('controls.block')}
            icon={<UserX />}
            onClick={onBlock}
            disabled={!hasPeer}
          />

          {/* Stop — ends the whole session. */}
          {active && (
            <GridControlButton
              label={t('controls.stop')}
              icon={<PhoneOff />}
              danger
              onClick={r.stop}
            />
          )}
        </div>
      </Cell>

      {/* ── Bottom-right: CHAT (docked) ─────────────────────────── */}
      <Cell className="glass-panel bg-transparent">
        {hasPeer ? (
          <CallChat
            variant="docked"
            open
            onClose={() => r.setChatOpen(false)}
            messages={r.chatMessages}
            onSend={r.sendChatMessage}
            peerName={peer?.nickname ?? t('peerFallback')}
          />
        ) : (
          <div className="grid h-full place-items-center p-4 text-center">
            <span className="text-xs text-muted-foreground">{t('grid.chatIdle')}</span>
          </div>
        )}
      </Cell>

      {/* ── Reconnecting scrim (over the live grid) ─────────────── */}
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

      {/* ── Status overlay across the whole grid (no peer yet) ──── */}
      <AnimatePresence mode="wait">
        {!showStage && (
          <motion.div
            key={r.status}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 grid place-items-center bg-[#07070b]/80 backdrop-blur-sm"
          >
            {r.status === 'idle' || r.status === 'requesting' ? (
              <IdleScreen isVideo />
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
    </div>
  );
}
