'use client';

import { useId } from 'react';

/**
 * ruletka.top logo mark — a neon "roulette orbit".
 *
 * A gradient wheel ring (with a roulette gap) carries a bright ball/spark, with
 * a glowing gradient core and a faint inner ring for depth. It reads at once as
 * a spinning roulette wheel and as a connection orbit — the product in one mark.
 * Pure SVG (crisp at any size), themed via the neon CSS variables. Decorative:
 * always paired with an accessible label on its parent. Each instance gets a
 * unique gradient id so multiple marks can coexist on a page.
 */
export function Logo({ size = 36, className }: { size?: number; className?: string }) {
  const uid = useId().replace(/:/g, '');
  const grad = `rl-grad-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={grad} x1="7" y1="6" x2="41" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--color-neon-violet)" />
          <stop offset="0.52" stopColor="var(--color-neon-magenta)" />
          <stop offset="1" stopColor="var(--color-neon-cyan)" />
        </linearGradient>
      </defs>

      {/* Faint inner ring — depth. */}
      <circle
        cx="24"
        cy="24"
        r="10.5"
        stroke="var(--color-neon-cyan)"
        strokeOpacity="0.32"
        strokeWidth="1.4"
      />

      {/* Outer wheel ring with a roulette gap. */}
      <circle
        cx="24"
        cy="24"
        r="18"
        stroke={`url(#${grad})`}
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeDasharray="84 29"
        transform="rotate(-108 24 24)"
      />

      {/* The ball / spark riding the ring (top) with a soft halo. */}
      <circle cx="24" cy="6" r="6" fill="var(--color-neon-cyan)" opacity="0.22" />
      <circle cx="24" cy="6" r="3.3" fill="var(--color-neon-cyan)" />

      {/* Glowing gradient core. */}
      <circle cx="24" cy="24" r="3.1" fill={`url(#${grad})`} />
    </svg>
  );
}
