import { ImageResponse } from 'next/og';

/**
 * Shared renderer for the app's neon "ring" mark — the same favicon motif
 * (a glowing orbit ring around a bright core) re-drawn with `ImageResponse`
 * (Satori) at arbitrary square sizes. Used by the PWA manifest icons
 * (192 / 512 / maskable) and the iOS `apple-icon`, so installable home-screen
 * icons are produced WITHOUT shipping any binary PNG asset.
 *
 * ── Satori notes ──────────────────────────────────────────────────────────
 *  - Flexbox only; every multi-child element needs explicit `display:'flex'`.
 *  - `background-clip:text` is unsupported, so the energy comes from gradient
 *    washes, a neon ring and glows (mirrors `og-card.tsx`).
 */

/** Brand stops (hex mirrors of the favicon gradient / `--neon-*` tokens). */
const VIOLET = '#b368ff';
const MAGENTA = '#ff4ac1';
const CYAN = '#00e0f5';
const VOID = '#0a0a0f';

export const ICON_CONTENT_TYPE = 'image/png';

/**
 * Render the square mark at `size` px.
 *
 * @param size    Edge length in px (e.g. 180 for apple, 512 for the manifest).
 * @param maskable When true, the bright art is inset within the safe zone and
 *   the background fills the full bleed, so Android's maskable crop (any shape)
 *   never clips the mark. The icon should be declared `purpose: "maskable"`.
 */
export function renderIconMark(size: number, maskable = false): ImageResponse {
  // Maskable icons must keep their content inside a ~80% safe circle; shrink the
  // art and rely on the full-bleed background to take the crop.
  const scale = maskable ? 0.66 : 0.82;
  const ring = Math.round(size * scale);
  const ringBorder = Math.max(6, Math.round(ring * 0.13));
  const core = Math.round(ring * 0.26);
  // Rounded-square plate only for the non-maskable (transparent-friendly) icon;
  // maskable uses the platform's own mask, so we keep a full square bleed.
  const radius = maskable ? 0 : Math.round(size * 0.22);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: VOID,
          backgroundImage: `radial-gradient(120% 120% at 30% 20%, rgba(179,104,255,0.55), transparent 55%), radial-gradient(120% 120% at 80% 90%, rgba(0,224,245,0.45), transparent 55%), radial-gradient(110% 110% at 75% 15%, rgba(255,74,193,0.40), transparent 50%)`,
          borderRadius: radius,
        }}
      >
        {/* Orbit ring. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: ring,
            height: ring,
            borderRadius: '50%',
            border: `${ringBorder}px solid ${VIOLET}`,
            boxShadow: `0 0 0 ${Math.round(ringBorder * 0.5)}px rgba(0,224,245,0.45), 0 0 ${Math.round(size * 0.18)}px rgba(179,104,255,0.85)`,
          }}
        >
          {/* Bright core. */}
          <div
            style={{
              width: core,
              height: core,
              borderRadius: '50%',
              backgroundColor: CYAN,
              boxShadow: `0 0 ${Math.round(size * 0.12)}px ${MAGENTA}`,
            }}
          />
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
