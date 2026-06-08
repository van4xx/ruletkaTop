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
export function drawDownscaledFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): boolean {
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

/**
 * Grab ONE downscaled JPEG evidence frame from a live {@link MediaStream} (e.g.
 * the remote peer's feed when a user files an in-call report). Self-contained:
 * binds the stream to a transient offscreen `<video>`, waits briefly for a
 * decodable frame, draws it to an offscreen canvas and serialises it — then
 * tears everything down. Best-effort: returns `null` on any failure (no video
 * track, frame never arrived, encoding/taint error) so the caller can simply
 * report without evidence rather than block the user.
 *
 * Only usable in the browser (needs `document`); guarded so importing it in a
 * non-DOM context is safe.
 */
export async function captureStreamFrame(stream: MediaStream | null): Promise<string | null> {
  if (typeof document === 'undefined' || !stream) return null;
  if (stream.getVideoTracks().length === 0) return null;

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;

  try {
    await video.play().catch(() => undefined);
    // Wait (briefly) for the first decodable frame; the stream is already live
    // in the visible tile, so this normally resolves within a frame or two.
    const ready = await waitForFrame(video);
    if (!ready) return null;

    const canvas = document.createElement('canvas');
    if (!drawDownscaledFrame(video, canvas)) return null;
    return canvasToEvidence(canvas);
  } catch {
    return null;
  } finally {
    try {
      video.pause();
    } catch {
      /* ignore */
    }
    video.srcObject = null;
  }
}

/** Longest time (ms) we wait for an offscreen video to produce a frame. */
const FRAME_WAIT_TIMEOUT_MS = 600;

/**
 * Resolve `true` once `video` reports a non-zero frame size (i.e. a frame is
 * decodable), or `false` after {@link FRAME_WAIT_TIMEOUT_MS}. Polls cheaply
 * rather than relying on a single event, since the stream may already be primed.
 */
function waitForFrame(video: HTMLVideoElement): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= FRAME_WAIT_TIMEOUT_MS) {
        resolve(false);
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}
