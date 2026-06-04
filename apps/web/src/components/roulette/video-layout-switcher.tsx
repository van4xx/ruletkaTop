'use client';

/**
 * The /video layout switcher: a small segmented `glass-panel` control to toggle
 * the stage between the classic Standard layout and the 2×2 Grid, plus a
 * separate Maximize/Minimize button for fullscreen.
 *
 * - The grid segment is video-only (voice has no peer/me video grid), so for
 *   `isVideo === false` we render just the fullscreen toggle.
 * - Reads/writes the persisted {@link useRouletteLayoutStore}; fullscreen is an
 *   ephemeral flag owned by the stage and passed in as a prop.
 */
import { useTranslations } from 'next-intl';
import { Columns2, LayoutGrid, Maximize2, Minimize2 } from 'lucide-react';
import { IconButton, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@ruletka/ui';
import {
  useRouletteLayoutStore,
  type RouletteLayoutMode,
} from '@/lib/stores/roulette-layout-store';
import { cn } from '@/lib/cn';

export interface VideoLayoutSwitcherProps {
  isVideo: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Compact spacing for the tiny fullscreen header. */
  compact?: boolean;
  className?: string;
}

function SegmentButton({
  label,
  selected,
  onClick,
  children,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-pressed={selected}
          className={cn(
            'inline-flex size-9 items-center justify-center rounded-lg transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            '[&_svg]:size-[1.05rem]',
            selected
              ? 'bg-aurora text-accent-foreground shadow-glow'
              : 'text-muted-foreground hover:bg-glass hover:text-foreground',
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function VideoLayoutSwitcher({
  isVideo,
  fullscreen,
  onToggleFullscreen,
  compact = false,
  className,
}: VideoLayoutSwitcherProps) {
  const t = useTranslations('roulette');
  const mode = useRouletteLayoutStore((s) => s.mode);
  const setMode = useRouletteLayoutStore((s) => s.setMode);

  const select = (next: RouletteLayoutMode) => setMode(next);

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn('flex items-center gap-1.5', className)}>
        {/* Standard ↔ Grid segmented control (video only). */}
        {isVideo && (
          <div
            role="group"
            aria-label={t('layout.groupLabel')}
            className={cn(
              'glass-panel inline-flex items-center gap-1 rounded-xl p-1',
              compact && 'p-0.5',
            )}
          >
            <SegmentButton
              label={t('layout.standard')}
              selected={mode === 'standard'}
              onClick={() => select('standard')}
            >
              <Columns2 />
            </SegmentButton>
            <SegmentButton
              label={t('layout.grid')}
              selected={mode === 'grid'}
              onClick={() => select('grid')}
            >
              <LayoutGrid />
            </SegmentButton>
          </div>
        )}

        {/* Fullscreen toggle (both modes). */}
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              aria-label={fullscreen ? t('layout.exitFullscreen') : t('layout.fullscreen')}
              aria-pressed={fullscreen}
              variant="glass"
              size={compact ? 'sm' : 'md'}
              onClick={onToggleFullscreen}
            >
              {fullscreen ? <Minimize2 /> : <Maximize2 />}
            </IconButton>
          </TooltipTrigger>
          <TooltipContent>
            {fullscreen ? t('layout.exitFullscreen') : t('layout.fullscreen')}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
