import { renderIconMark, ICON_CONTENT_TYPE } from '../icon-mark';

/**
 * 192×192 PWA icon (manifest `purpose: "any"`), generated with `ImageResponse`
 * — no binary asset. Served at `/icon-192`.
 */
export const contentType = ICON_CONTENT_TYPE;

export function GET() {
  return renderIconMark(192);
}
