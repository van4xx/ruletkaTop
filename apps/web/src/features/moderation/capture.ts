'use client';

/**
 * Frame capture helpers for on-device screening.
 *
 * A single reusable offscreen canvas downscales the local video for both
 * classification (smaller = faster inference) and evidence (smaller = cheaper to
 * POST + store). Reusing one canvas avoids per-frame allocation churn during a
 * long call.
 */

/** Longest edge (px) of the downscaled frame used for classification/evidence. */
const MAX_EDGE = 224;

/** JPEG quality for the evidence data-URL — low, since it's a thumbnail. */
const EVIDENCE_QUALITY = 0.6;

/**
 * Draw the current `video` frame onto `canvas`, downscaled so its longest edge
 * is at most {@link MAX_EDGE}px (preserving aspect ratio). Returns `false` when
 * the video has no frame yet (camera warming up), in which case the canvas is
 * left untouched and callers should skip this tick.
 */
export function drawDownscaledFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): boolean {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return false;

  const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh));
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));

  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  try {
    ctx.drawImage(video, 0, 0, w, h);
    return true;
  } catch {
    // drawImage can throw on a tainted/again-not-ready surface; treat as a skip.
    return false;
  }
}

/**
 * Serialize the current canvas contents to a compact JPEG data-URL for evidence.
 * Returns `null` if encoding fails (e.g. a tainted canvas).
 */
export function canvasToEvidence(canvas: HTMLCanvasElement): string | null {
  try {
    const url = canvas.toDataURL('image/jpeg', EVIDENCE_QUALITY);
    return url.startsWith('data:image/jpeg') ? url : null;
  } catch {
    return null;
  }
}
