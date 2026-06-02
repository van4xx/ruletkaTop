'use client';

/**
 * Renders a gift's animation. `animationUrl` may point at a Lottie JSON, a
 * video, a GIF/APNG, or a still image — we pick a renderer by extension and
 * gracefully fall back to a rarity-tinted gift glyph if it errors or is empty.
 *
 * (Lottie has no runtime dependency available here, so `.json` animations fall
 * back to the glyph; the integrator can wire a Lottie player later.)
 */
import { useState } from 'react';
import { Gift as GiftGlyph } from 'lucide-react';
import type { Rarity } from '@ruletka/shared-types';
import { cn } from '@/lib/cn';
import { RARITY_STYLES } from '@/features/gifts/rarity';

export interface GiftMediaProps {
  url: string;
  title: string;
  rarity: Rarity;
  className?: string;
}

function kind(url: string): 'video' | 'image' | 'glyph' {
  const clean = url.split('?')[0]?.toLowerCase() ?? '';
  if (/\.(mp4|webm|mov)$/.test(clean)) return 'video';
  if (/\.(gif|png|apng|webp|jpg|jpeg|svg|avif)$/.test(clean)) return 'image';
  return 'glyph';
}

export function GiftMedia({ url, title, rarity, className }: GiftMediaProps) {
  const [failed, setFailed] = useState(false);
  const style = RARITY_STYLES[rarity];
  const resolved = url && !failed ? kind(url) : 'glyph';

  return (
    <div
      className={cn(
        'relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl',
        className,
      )}
    >
      {/* Rarity glow wash. */}
      <div aria-hidden="true" className={cn('absolute inset-0 bg-gradient-to-br', style.glow)} />
      {resolved === 'video' && (
        <video
          src={url}
          autoPlay
          loop
          muted
          playsInline
          onError={() => setFailed(true)}
          className="relative h-4/5 w-4/5 object-contain"
        />
      )}
      {resolved === 'image' && (
        // eslint-disable-next-line @next/next/no-img-element -- remote, dynamic gift assets
        <img
          src={url}
          alt={title}
          loading="lazy"
          onError={() => setFailed(true)}
          className="relative h-4/5 w-4/5 object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.35)]"
        />
      )}
      {resolved === 'glyph' && (
        <GiftGlyph
          className="relative h-1/2 w-1/2 motion-safe:animate-pulse"
          style={{ color: style.color }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
