'use client';

/**
 * Two-direction "Top" marquee — a teaser for the paid Top feed.
 *
 * Two vertical lanes scroll in opposite directions (left lane up, right lane
 * down), evoking the live, money-driven Top leaderboard. Purely decorative on
 * the landing page; the real feed lives at `/top`. Content is duplicated so the
 * CSS keyframe loop (`marquee-up` / `marquee-down`, defined in globals.css)
 * appears seamless. Respects `prefers-reduced-motion` (animations are
 * neutralised globally).
 */
import { cn } from '@/lib/cn';

interface TopCardData {
  nick: string;
  country: string;
  /** Tailwind gradient classes for the avatar bubble. */
  hue: string;
}

const LEFT_LANE: TopCardData[] = [
  { nick: 'mira_x', country: '🇷🇺', hue: 'from-violet-500 to-fuchsia-500' },
  { nick: 'leoo', country: '🇩🇪', hue: 'from-cyan-400 to-sky-500' },
  { nick: 'sunflower', country: '🇫🇷', hue: 'from-amber-400 to-pink-500' },
  { nick: 'nikita99', country: '🇰🇿', hue: 'from-emerald-400 to-teal-500' },
  { nick: 'aria', country: '🇮🇹', hue: 'from-fuchsia-500 to-violet-500' },
];

const RIGHT_LANE: TopCardData[] = [
  { nick: 'voltage', country: '🇺🇦', hue: 'from-sky-400 to-indigo-500' },
  { nick: 'kira.m', country: '🇵🇱', hue: 'from-rose-400 to-orange-400' },
  { nick: 'darkmoon', country: '🇪🇸', hue: 'from-purple-500 to-cyan-400' },
  { nick: 'temo', country: '🇬🇪', hue: 'from-teal-400 to-emerald-500' },
  { nick: 'lenny', country: '🇨🇿', hue: 'from-pink-500 to-violet-500' },
];

function TopCard({ data, rank }: { data: TopCardData; rank: number }) {
  const initials = data.nick.slice(0, 2).toUpperCase();
  return (
    <div className="glass-panel flex items-center gap-3 rounded-2xl p-3">
      <span className="w-5 text-center text-xs font-bold text-muted-foreground tabular-nums">
        {rank}
      </span>
      <span
        className={cn(
          'inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white',
          data.hue,
        )}
        aria-hidden="true"
      >
        {initials}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold">{data.nick}</span>
        <span className="text-xs text-muted-foreground">в эфире {data.country}</span>
      </span>
    </div>
  );
}

function Lane({ items, direction }: { items: TopCardData[]; direction: 'up' | 'down' }) {
  // Duplicate the list so a -50% translate loops seamlessly.
  const doubled = [...items, ...items];
  return (
    <div className="relative h-full overflow-hidden">
      <div
        className="flex flex-col gap-3"
        style={{
          animation: `${direction === 'up' ? 'marquee-up' : 'marquee-down'} 18s linear infinite`,
        }}
      >
        {doubled.map((data, i) => (
          <TopCard key={`${data.nick}-${i}`} data={data} rank={(i % items.length) + 1} />
        ))}
      </div>
    </div>
  );
}

export function TopMarquee({ className }: { className?: string }) {
  return (
    <div className={cn('relative grid h-[440px] grid-cols-2 gap-3', className)} aria-hidden="true">
      <Lane items={LEFT_LANE} direction="up" />
      <Lane items={RIGHT_LANE} direction="down" />

      {/* Top/bottom fade masks so cards dissolve into the background. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-background to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}
