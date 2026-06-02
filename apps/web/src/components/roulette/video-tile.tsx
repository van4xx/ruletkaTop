'use client';

/**
 * A single video surface. Used both for the full-screen remote feed and the
 * draggable local PiP. Attaches a {@link MediaStream} to a `<video>` element,
 * handles muted/mirror options, and renders a graceful placeholder when the
 * stream is absent or the camera is off.
 */
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { ShieldAlert, VideoOff } from 'lucide-react';
import { Avatar } from '@ruletka/ui';
import { cn } from '@/lib/cn';

export interface VideoTileProps {
  stream: MediaStream | null;
  /** Mute the audio element (always true for the local tile to avoid echo). */
  muted?: boolean;
  /** Mirror horizontally (natural for a selfie / local camera). */
  mirror?: boolean;
  /** When true, hide the video and show a "camera off" placeholder. */
  cameraOff?: boolean;
  /**
   * When true, the on-device moderation screen flagged this (local) feed: blur
   * it heavily and overlay a warning. Distinct from `cameraOff` (a user action).
   */
  flagged?: boolean;
  /** Fallback identity shown in the placeholder. */
  placeholderName?: string;
  placeholderAvatar?: string | null;
  className?: string;
  /** object-fit; remote uses cover, local PiP uses cover too. */
  fit?: 'cover' | 'contain';
}

export function VideoTile({
  stream,
  muted = false,
  mirror = false,
  cameraOff = false,
  flagged = false,
  placeholderName,
  placeholderAvatar,
  className,
  fit = 'cover',
}: VideoTileProps) {
  const t = useTranslations('roulette');
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    if (stream) {
      // Autoplay can reject (e.g. before a user gesture); ignore — controls
      // and the next gesture recover it.
      void el.play().catch(() => undefined);
    }
  }, [stream]);

  const showPlaceholder = !stream || cameraOff;
  // When flagged (and not already hidden by camera-off), keep the video mounted
  // but obscure it behind a heavy blur + moderation overlay.
  const showFlag = flagged && !showPlaceholder;

  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-black/40', className)}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={cn(
          'h-full w-full',
          fit === 'cover' ? 'object-cover' : 'object-contain',
          mirror && 'scale-x-[-1]',
          showPlaceholder && 'invisible',
          // Heavy blur + dim so the flagged frame is not legible.
          showFlag && 'scale-110 blur-2xl brightness-50',
        )}
      />
      {showFlag && (
        <div className="absolute inset-0 grid place-items-center bg-destructive/25 backdrop-blur-md">
          <div className="flex flex-col items-center gap-2 px-3 text-center">
            <ShieldAlert className="h-7 w-7 text-destructive" aria-hidden="true" />
            <span className="text-xs font-semibold text-white">{t('videoTile.hiddenTitle')}</span>
            <span className="text-[0.625rem] leading-tight text-white/80">
              {t('videoTile.hiddenSubtitle')}
            </span>
          </div>
        </div>
      )}
      {showPlaceholder && (
        <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_center,color-mix(in_oklch,var(--color-neon-violet)_18%,transparent),transparent_70%)]">
          <div className="flex flex-col items-center gap-3 text-center">
            {placeholderName !== undefined ? (
              <Avatar
                size="xl"
                src={placeholderAvatar ?? undefined}
                alt={placeholderName}
                ring="aurora"
              />
            ) : null}
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <VideoOff className="h-4 w-4" aria-hidden="true" />
              {cameraOff ? t('videoTile.cameraOff') : t('videoTile.noVideo')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
