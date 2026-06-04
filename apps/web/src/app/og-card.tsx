import { ImageResponse } from 'next/og';

/**
 * Shared renderer for the default social card (Open Graph + Twitter).
 *
 * Branded, distinctive default card for a bold, energetic video-roulette social
 * app — it leans on the product's signature palette: a near-black "void"
 * background with electric violet → magenta → cyan neon accents (the same stops
 * used by `--neon-*` in globals.css / the favicon gradient).
 *
 * ── Implementation notes (Satori) ─────────────────────────────────────────
 * `ImageResponse` renders JSX with Satori, which supports a SUBSET of CSS:
 *  - Flexbox only; every multi-child element needs an explicit `display:'flex'`.
 *  - `background-clip:text` (gradient text) is NOT supported — so the wordmark is
 *    a solid bright fill and the neon energy comes from gradient glows, the brand
 *    ring mark and an accent underline bar instead.
 *  - No custom font is loaded (keeps the build dependency-free); Satori's built-in
 *    sans is used with a heavy weight for the display feel.
 * The default 1200×630 frame is the canonical OG/Twitter size.
 */

export const SIZE = { width: 1200, height: 630 } as const;
export const CONTENT_TYPE = 'image/png';

/** Brand stops (hex mirrors of the OKLCH `--neon-*` tokens + the favicon). */
const VIOLET = '#a855f7';
const MAGENTA = '#ec4899';
const CYAN = '#22d3ee';
const VOID = '#0a0a0f';

/**
 * Build the branded card. `title`/`tagline` are passed in (localized) by the
 * route file so the ru/en default cards read correctly.
 */
export function renderOgCard(title: string, tagline: string): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 80,
          backgroundColor: VOID,
          // Base atmospheric gradient (corner wash) on the void surface.
          backgroundImage: `radial-gradient(1100px 600px at 18% 8%, rgba(168,85,247,0.30), transparent 60%), radial-gradient(900px 600px at 92% 96%, rgba(34,211,238,0.22), transparent 60%), radial-gradient(700px 500px at 85% 12%, rgba(236,72,153,0.20), transparent 55%)`,
          fontFamily: 'sans-serif',
          color: '#f5f3ff',
          position: 'relative',
        }}
      >
        {/* Top row: brand mark (ring + core) + wordmark. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          {/* The favicon's ring mark, re-drawn at OG scale with a neon glow. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 116,
              height: 116,
              borderRadius: 32,
              backgroundColor: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 76,
                height: 76,
                borderRadius: '50%',
                border: `8px solid ${VIOLET}`,
                // Inner accent ring via box-shadow toward cyan for the neon feel.
                boxShadow: `0 0 0 4px rgba(34,211,238,0.35), 0 0 40px rgba(168,85,247,0.7)`,
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  backgroundColor: CYAN,
                  boxShadow: `0 0 26px ${CYAN}`,
                }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 40, fontWeight: 800, letterSpacing: -1 }}>
              ruletka.top
            </div>
            <div
              style={{
                display: 'flex',
                marginTop: 6,
                fontSize: 22,
                fontWeight: 600,
                color: CYAN,
                textTransform: 'uppercase',
                letterSpacing: 4,
              }}
            >
              video · voice · live
            </div>
          </div>
        </div>

        {/* Headline + tagline block. */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Accent gradient bar — the neon "spectrum" the wordmark can't be. */}
          <div
            style={{
              display: 'flex',
              width: 220,
              height: 12,
              borderRadius: 999,
              marginBottom: 32,
              backgroundImage: `linear-gradient(90deg, ${VIOLET}, ${MAGENTA} 50%, ${CYAN})`,
              boxShadow: `0 0 36px rgba(236,72,153,0.55)`,
            }}
          />
          <div
            style={{
              display: 'flex',
              fontSize: 86,
              fontWeight: 800,
              lineHeight: 1.04,
              letterSpacing: -2,
              maxWidth: 940,
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: 28,
              fontSize: 34,
              fontWeight: 500,
              lineHeight: 1.3,
              color: 'rgba(245,243,255,0.72)',
              maxWidth: 900,
            }}
          >
            {tagline}
          </div>
        </div>

        {/* Bottom hairline + domain, for a finished, intentional frame. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid rgba(255,255,255,0.12)',
            paddingTop: 28,
            fontSize: 26,
            fontWeight: 600,
            color: 'rgba(245,243,255,0.78)',
          }}
        >
          <div style={{ display: 'flex' }}>https://ruletka.top</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {[VIOLET, MAGENTA, CYAN].map((c) => (
              <div
                key={c}
                style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      </div>
    ),
    { ...SIZE },
  );
}
