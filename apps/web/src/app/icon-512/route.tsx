import { renderIconMark, ICON_CONTENT_TYPE } from '../icon-mark';

/**
 * 512×512 PWA icon (manifest `purpose: "any"`), generated with `ImageResponse`
 * — no binary asset. Served at `/icon-512`.
 */
export const contentType = ICON_CONTENT_TYPE;

export function GET() {
  return renderIconMark(512);
}
