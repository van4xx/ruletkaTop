'use client';

/**
 * useLocalScreening — on-device NSFW screening of the LOCAL camera during a
 * video call.
 *
 * Given the live local {@link MediaStream}, it:
 *   1. Pipes it into a private offscreen `<video>` (never rendered) so we can
 *      grab frames independently of the visible preview.
 *   2. Every {@link SAMPLE_INTERVAL_MS}, downscales the current frame to a small
 *      offscreen canvas and runs it through the lazy {@link NsfwClassifier}.
 *   3. On a violation (per the conservative {@link evaluate} policy):
 *        • flips `flagged → true` so the UI INSTANTLY blurs/cuts the local
 *          preview (the offender stops broadcasting offensive content to
 *          themselves *and*, paired with track-disable in the stage, the peer),
 *        • POSTs the violation + a JPEG evidence data-URL to `/moderation/frame`
 *          (rate-limited), tagged with the current matchId + mapped label/score.
 *   4. After a cooldown with clean frames, clears `flagged` so an accidental
 *      trip self-heals.
 *
 * The whole thing is defensive: the model is lazy + swappable, every async step
 * is wrapped, and any failure degrades to "screening off" — it NEVER throws into
 * the call lifecycle.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModerationLabel } from '@ruletka/shared-types';

import {
  createClassifier,
  type ClassificationResult,
  type NsfwClassifier,
} from './classifier';
import { canvasToEvidence, drawDownscaledFrame } from './capture';
import { moderationApi } from './api';
import {
  REPORT_MIN_GAP_MS,
  SAMPLE_INTERVAL_MS,
  VIOLATION_COOLDOWN_MS,
  evaluate,
} from './policy';

export interface LocalScreeningOptions {
  /** The live local media stream, or null when not in a call. */
  stream: MediaStream | null;
  /** Current matched room/match id, attached to reports. */
  matchId: string | null;
  /**
   * Master switch. Screening only runs for video calls; pass `false` for voice
   * (no video to screen) or to disable entirely. Defaults to the stream having
   * a video track when omitted.
   */
  enabled?: boolean;
  /**
   * Fired once each time a violation trips (after the local cut). Lets the host
   * surface a gentle warning toast. Receives the mapped label + score.
   */
  onViolation?: (info: { label: ModerationLabel; score: number }) => void;
}

export interface LocalScreeningResult {
  /**
   * True while the local preview should be blurred/cut due to a recent
   * violation. The call UI binds this to the local tile.
   */
  flagged: boolean;
  /** The most recent tripped violation (for optional UI), or null. */
  lastViolation: { label: ModerationLabel; score: number; at: number } | null;
  /** True once the model has been requested (UI may show a subtle "scanning"). */
  active: boolean;
}

export function useLocalScreening({
  stream,
  matchId,
  enabled,
  onViolation,
}: LocalScreeningOptions): LocalScreeningResult {
  const [flagged, setFlagged] = useState(false);
  const [active, setActive] = useState(false);
  const [lastViolation, setLastViolation] =
    useState<LocalScreeningResult['lastViolation']>(null);

  // Live, non-render handles.
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const classifierRef = useRef<NsfwClassifier | null>(null);
  const flaggedUntilRef = useRef<number>(0);
  const lastReportAtRef = useRef<number>(0);
  const busyRef = useRef(false);
  const matchIdRef = useRef<string | null>(matchId);
  const onViolationRef = useRef(onViolation);

  useEffect(() => {
    matchIdRef.current = matchId;
  }, [matchId]);
  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  // Whether screening should run: explicitly enabled, or (when unspecified) the
  // stream carries video. Voice-only streams have nothing to screen.
  const hasVideoTrack = (stream?.getVideoTracks().length ?? 0) > 0;
  const shouldRun = (enabled ?? hasVideoTrack) && Boolean(stream) && hasVideoTrack;

  /** Report a tripped violation to the server (rate-limited, best-effort). */
  const report = useCallback((result: ClassificationResult) => {
    const now = Date.now();
    if (now - lastReportAtRef.current < REPORT_MIN_GAP_MS) return;
    lastReportAtRef.current = now;

    const canvas = canvasRef.current;
    const evidence = canvas ? canvasToEvidence(canvas) : null;

    // Fire-and-forget; failures are swallowed so screening never breaks a call.
    void moderationApi
      .reportFrame({
        matchId: matchIdRef.current ?? undefined,
        label: result.label,
        score: result.score,
        evidence: evidence ?? undefined,
      })
      .catch(() => undefined);
  }, []);

  /** Run one sample tick: draw → classify → enforce/report. */
  const tick = useCallback(async () => {
    if (busyRef.current) return; // skip if a previous classify is still running
    const video = videoElRef.current;
    const canvas = canvasRef.current;
    const classifier = classifierRef.current;
    if (!video || !canvas || !classifier) return;

    busyRef.current = true;
    try {
      const drew = drawDownscaledFrame(video, canvas);
      if (!drew) return;

      const result = await classifier.classify(canvas);
      const violation = evaluate(result);
      const now = Date.now();

      if (violation) {
        flaggedUntilRef.current = now + VIOLATION_COOLDOWN_MS;
        setFlagged(true);
        setLastViolation({ label: violation.label, score: violation.score, at: now });
        onViolationRef.current?.({ label: violation.label, score: violation.score });
        report(violation);
      } else if (flaggedUntilRef.current && now >= flaggedUntilRef.current) {
        // Cooldown elapsed with a clean frame → self-heal.
        flaggedUntilRef.current = 0;
        setFlagged(false);
      }
    } catch {
      /* never throw out of the loop */
    } finally {
      busyRef.current = false;
    }
  }, [report]);

  // ── Bind the stream into a private offscreen video + run the sample loop. ──
  useEffect(() => {
    if (!shouldRun || !stream) {
      // Tear down any prior session state when screening shouldn't run.
      setFlagged(false);
      setActive(false);
      flaggedUntilRef.current = 0;
      return;
    }

    setActive(true);

    // Private elements — created once per active session, never in the DOM.
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    videoElRef.current = video;

    const canvas = document.createElement('canvas');
    canvasRef.current = canvas;

    classifierRef.current = createClassifier();

    const interval = setInterval(() => {
      void tick();
    }, SAMPLE_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      try {
        video.pause();
      } catch {
        /* ignore */
      }
      video.srcObject = null;
      videoElRef.current = null;
      canvasRef.current = null;
      classifierRef.current?.dispose();
      classifierRef.current = null;
      busyRef.current = false;
      flaggedUntilRef.current = 0;
      lastReportAtRef.current = 0;
    };
    // `stream` identity changing (new call) re-binds; `shouldRun` toggles on/off.
    // `tick` is stable (depends only on stable `report`).
  }, [stream, shouldRun, tick]);

  return { flagged, lastViolation, active };
}
