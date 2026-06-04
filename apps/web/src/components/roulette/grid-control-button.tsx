'use client';

/**
 * A big, beautiful SQUARE control tile — the signature of the grid layout's
 * bottom-left "controls" cell. Each tile is a glass square with an icon stacked
 * over a tiny label.
 *
 * Visual states (mirrors {@link CallControls}'s circular buttons):
 *   - default  → frosted `glass`
 *   - active   → aurora gradient + glow (e.g. mic muted / camera off / chat open)
 *   - primary  → aurora gradient (Start / Next — the core loop)
 *   - danger   → red (Stop, or a destructive toggle)
 *   - disabled → dimmed + non-interactive (social actions before a peer joins)
 *
 * Reuses the exact handlers/icons from the floating control bar; only the
 * presentation differs (square tile + label instead of a circular icon button).
 */
import { cn } from '@/lib/cn';

export interface GridControlButtonProps {
  /** Visible label under the icon (also the accessible name). */
  label: string;
  /** lucide icon node. */
  icon: React.ReactNode;
  onClick: () => void;
  /** Toggle is "on" (aurora highlight) — e.g. chat open. */
  active?: boolean;
  /** Render the aurora gradient as a primary action (Start / Next). */
  primary?: boolean;
  /** Render the danger (red) treatment — e.g. mic muted, camera off, Stop. */
  danger?: boolean;
  disabled?: boolean;
  /** Reflect a pressed/toggle state to assistive tech. */
  pressed?: boolean;
  className?: string;
}

export function GridControlButton({
  label,
  icon,
  onClick,
  active = false,
  primary = false,
  danger = false,
  disabled = false,
  pressed,
  className,
}: GridControlButtonProps) {
  const highlighted = primary || active;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        'group relative flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-2xl',
        'min-h-0 px-1 text-[11px] font-medium leading-tight',
        'transition-[transform,box-shadow,background-color,color] duration-[var(--duration-fast)] ease-[var(--ease-out-quart)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'active:scale-90 disabled:pointer-events-none disabled:opacity-40',
        '[&_svg]:size-5 sm:[&_svg]:size-6',
        danger
          ? 'bg-danger text-danger-foreground hover:brightness-110 focus-visible:ring-danger'
          : highlighted
            ? 'bg-aurora text-accent-foreground shadow-glow hover:shadow-glow-strong'
            : 'glass text-foreground hover:bg-glass-strong',
        className,
      )}
    >
      {icon}
      <span className="line-clamp-1 max-w-full">{label}</span>
    </button>
  );
}
