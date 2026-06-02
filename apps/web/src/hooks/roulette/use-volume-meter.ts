'use client';

/**
 * A Web-Audio level meter. Given a {@link MediaStream}, it builds an
 * `AnalyserNode` and exposes a *ref* of frequency-bin magnitudes (0..1) plus a
 * scalar overall level. We deliberately expose refs (not state) and let the
 * consumer read them inside its own `requestAnimationFrame` loop, so the
 * visualizer animates at 60fps without triggering React re-renders.
 */
import { useEffect, useRef } from 'react';

export interface VolumeMeter {
  /** Normalised per-band magnitudes (0..1), length === `bands`. */
  bandsRef: React.RefObject<Float32Array>;
  /** Overall normalised loudness (0..1). */
  levelRef: React.RefObject<number>;
  /** True while the audio graph is live. */
  activeRef: React.RefObject<boolean>;
}

const FFT_SIZE = 256;

export function useVolumeMeter(stream: MediaStream | null, bands = 28): VolumeMeter {
  const bandsRef = useRef<Float32Array>(new Float32Array(bands));
  const levelRef = useRef<number>(0);
  const activeRef = useRef<boolean>(false);

  useEffect(() => {
    bandsRef.current = new Float32Array(bands);
    levelRef.current = 0;
    activeRef.current = false;

    if (!stream || stream.getAudioTracks().length === 0) return;

    type AudioContextCtor = typeof AudioContext;
    const Ctx: AudioContextCtor | undefined =
      typeof window !== 'undefined'
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext)
        : undefined;
    if (!Ctx) return;

    let raf = 0;
    let audioCtx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;

    try {
      audioCtx = new Ctx();
      source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.78;
      source.connect(analyser);
      activeRef.current = true;
    } catch {
      return;
    }

    const binCount = analyser.frequencyBinCount;
    const freq = new Uint8Array(binCount);
    // Group the lower ~70% of bins (where voice energy lives) into `bands`.
    const usableBins = Math.floor(binCount * 0.7);
    const perBand = Math.max(1, Math.floor(usableBins / bands));

    const tick = () => {
      if (!analyser) return;
      analyser.getByteFrequencyData(freq);
      let sum = 0;
      const out = bandsRef.current;
      for (let b = 0; b < bands; b++) {
        let acc = 0;
        const start = b * perBand;
        for (let i = 0; i < perBand; i++) acc += freq[start + i] ?? 0;
        const v = acc / perBand / 255; // 0..1
        out[b] = v;
        sum += v;
      }
      levelRef.current = sum / bands;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      activeRef.current = false;
      try {
        source?.disconnect();
        analyser?.disconnect();
      } catch {
        /* noop */
      }
      // Close async; ignore the promise.
      void audioCtx?.close().catch(() => undefined);
    };
  }, [stream, bands]);

  return { bandsRef, levelRef, activeRef };
}
