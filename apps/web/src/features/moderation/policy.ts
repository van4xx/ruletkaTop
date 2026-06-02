'use client';

/**
 * Conservative on-device screening policy.
 *
 * The local classifier is a FIRST line of defense, not the judge: its only jobs
 * are to (a) instantly cut the local preview when a frame looks unsafe, and
 * (b) report the event (with an evidence frame) to the server, which owns the
 * real escalation policy (warn → kick → ban) and human review.
 *
 * Thresholds are deliberately HIGH to minimize false positives that would
 * wrongly cut an innocent user's camera — a missed frame is re-sampled seconds
 * later, but a false cut is a visible, trust-eroding bug. Tune via env without a
 * code change.
 */
import type { ClassificationResult } from './classifier';

/**
 * Parse a 0..1 threshold from a raw env string with a safe default.
 *
 * NOTE: `NEXT_PUBLIC_*` envs are only inlined by Next when accessed via a STATIC
 * `process.env.NEXT_PUBLIC_FOO` member expression — never via a computed key —
 * so each call site below passes the statically-read value, not the var name.
 */
function parseThreshold(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

/**
 * Per-label confidence required to treat a frame as a violation.
 * `sexual` (Porn/Hentai) trips earlier than `nudity` (Sexy), which is softer.
 */
export const THRESHOLDS = {
  /** Porn / Hentai — strong sexual content. */
  sexual: parseThreshold(process.env.NEXT_PUBLIC_MOD_THRESHOLD_SEXUAL, 0.7),
  /** Sexy — explicit but non-pornographic. */
  nudity: parseThreshold(process.env.NEXT_PUBLIC_MOD_THRESHOLD_NUDITY, 0.85),
} as const;

/** How often to sample the local video (ms). */
export const SAMPLE_INTERVAL_MS = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_MOD_SAMPLE_MS);
  return Number.isFinite(raw) && raw >= 1000 ? raw : 3000;
})();

/**
 * After a violation, keep the local preview blurred/cut for at least this long
 * before re-evaluating, so a single trip doesn't flicker the camera on/off.
 */
export const VIOLATION_COOLDOWN_MS = 8000;

/** Minimum gap between evidence POSTs, so we don't spam the API on a bad stream. */
export const REPORT_MIN_GAP_MS = 5000;

/**
 * Decide whether a classification result is a reportable violation under the
 * conservative thresholds. Returns `null` when the frame is acceptable.
 */
export function evaluate(result: ClassificationResult): ClassificationResult | null {
  if (result.label === 'sexual' && result.score >= THRESHOLDS.sexual) return result;
  if (result.label === 'nudity' && result.score >= THRESHOLDS.nudity) return result;
  return null;
}
