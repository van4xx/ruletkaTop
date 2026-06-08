import { renderIconMark, ICON_CONTENT_TYPE } from '../icon-mark';

/**
 * 512×512 maskable PWA icon (manifest `purpose: "maskable"`) — the mark is inset
 * within the safe zone so Android's adaptive-icon crop never clips it. Generated
 * with `ImageResponse` (no binary asset). Served at `/icon-maskable`.
 */
export const contentType = ICON_CONTENT_TYPE;

export function GET() {
  return renderIconMark(512, true);
}
