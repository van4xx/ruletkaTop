import { renderIconMark, ICON_CONTENT_TYPE } from './icon-mark';

/**
 * iOS home-screen icon — served at `/apple-icon` and auto-wired into
 * `<link rel="apple-touch-icon">` by Next. A 180×180 neon mark generated with
 * `ImageResponse` (no binary asset required). iOS applies its own rounded mask,
 * so we render the full-bleed (non-maskable) variant.
 */
export const size = { width: 180, height: 180 };
export const contentType = ICON_CONTENT_TYPE;

export default function AppleIcon() {
  return renderIconMark(180);
}
