'use client';

/**
 * The tiny, minimal header shown ONLY while the stage is fullscreen.
 *
 * Element-fullscreen hides the real {@link SiteHeader} (it lives outside the
 * fullscreened stage element), so this slim bar restores the essentials inside
 * it: the brand emblem, the {@link VideoLayoutSwitcher} (standard/grid + a
 * Minimize button to exit), and nothing else.
 *
 * It behaves like player chrome: visible on entry, then fades out after a short
 * idle; any pointer/touch/key activity over the stage reveals it again. The
 * parent drives `visible` (it watches stage activity) so the same timer governs
 * the cursor too.
 */
import { cn } from '@/lib/cn';
import { VideoLayoutSwitcher } from './video-layout-switcher';

export interface FullscreenBarProps {
  isVideo: boolean;
  onExit: () => void;
  /** Whether the bar is currently revealed (driven by stage activity). */
  visible: boolean;
}

export function FullscreenBar({ isVideo, onExit, visible }: FullscreenBarProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 z-40 flex items-center justify-between gap-3 p-2 sm:px-3',
        'transition-opacity duration-300 ease-out',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      {/* Brand emblem — purely decorative here (no navigation, to avoid tearing
          down the live call). Mirrors the SiteHeader mark. */}
      <div className="glass-panel pointer-events-auto flex items-center gap-2 rounded-xl px-2.5 py-1.5">
        <span className="relative inline-flex h-6 w-6 items-center justify-center" aria-hidden="true">
          <span className="absolute inset-0 rounded-full bg-[conic-gradient(from_140deg,var(--color-neon-violet),var(--color-neon-magenta),var(--color-neon-cyan),var(--color-neon-violet))] opacity-90 blur-[1px]" />
          <span className="absolute inset-[2px] rounded-full bg-background" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-[var(--color-neon-cyan)] shadow-[0_0_8px_var(--color-neon-cyan)]" />
        </span>
        <span className="font-display text-sm font-bold leading-none tracking-tight">
          ruletka<span className="text-gradient-neon">.top</span>
        </span>
      </div>

      <div className="pointer-events-auto">
        <VideoLayoutSwitcher
          isVideo={isVideo}
          fullscreen
          onToggleFullscreen={onExit}
          compact
        />
      </div>
    </div>
  );
}
