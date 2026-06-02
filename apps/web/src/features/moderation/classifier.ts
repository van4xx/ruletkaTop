'use client';

/**
 * On-device NSFW classifier — a swappable interface with a working default.
 *
 * The default backend is {@link https://github.com/infinitered/nsfwjs nsfwjs}
 * (TensorFlow.js MobileNetV2), which runs ENTIRELY in the browser: frames never
 * leave the device for classification. We only POST a downscaled evidence frame
 * to the API *after* a local violation is detected (see the moderation hook).
 *
 * Design goals:
 *  - **Lazy**: the ~2-4 MB model + tfjs are dynamically imported and loaded on
 *    the FIRST classify call, never at page load, so /video stays light until a
 *    call actually starts.
 *  - **Swappable**: everything is behind {@link NsfwClassifier}; a different
 *    backend (a WASM model, a server round-trip, a no-op) can be dropped in via
 *    {@link setClassifierFactory} without touching the call UI.
 *  - **Graceful**: if the model or tfjs fails to load (offline, blocked CDN,
 *    unsupported device) the classifier resolves to a no-op that always returns
 *    `safe` — screening silently disables itself and NEVER breaks the call.
 */
import type { ModerationLabel } from '@ruletka/shared-types';

/** A normalized classification result in the contract's label space. */
export interface ClassificationResult {
  /** Mapped contract label (worst applicable category, or `safe`). */
  label: ModerationLabel;
  /** Confidence of the winning unsafe category in [0,1] (0 when safe). */
  score: number;
  /** Raw per-class probabilities, for thresholding/telemetry if needed. */
  raw: Partial<Record<NsfwClassName, number>>;
}

/** The five raw classes nsfwjs returns. */
export type NsfwClassName = 'Drawing' | 'Hentai' | 'Neutral' | 'Porn' | 'Sexy';

/**
 * The minimal classifier surface the call UI depends on. Implementations must
 * be safe to call on every sampled frame and must never throw.
 */
export interface NsfwClassifier {
  /** Classify a video/canvas frame. Resolves to a normalized result. */
  classify(source: HTMLVideoElement | HTMLCanvasElement): Promise<ClassificationResult>;
  /** Best-effort release of model/tensor resources. */
  dispose(): void;
}

/** A `safe` result used when screening is unavailable. */
const SAFE_RESULT: ClassificationResult = { label: 'safe', score: 0, raw: {} };

/**
 * Map nsfwjs's raw predictions onto the contract's {@link ModerationLabel}.
 *
 * `Porn` and `Hentai` are the strongest "sexual content" signals → `sexual`.
 * `Sexy` is "explicit but non-pornographic" → `nudity` (a softer category that
 * the policy can treat as blur/warn). `Drawing`/`Neutral` are `safe`. We never
 * infer `minor`/`violence` from this model — those come from other signals.
 */
function mapPredictions(raw: Partial<Record<NsfwClassName, number>>): ClassificationResult {
  const porn = raw.Porn ?? 0;
  const hentai = raw.Hentai ?? 0;
  const sexy = raw.Sexy ?? 0;

  // Strongest sexual signal first.
  const sexual = Math.max(porn, hentai);
  if (sexual >= sexy) {
    return { label: 'sexual', score: sexual, raw };
  }
  return { label: 'nudity', score: sexy, raw };
}

// ─────────────────────────── nsfwjs default backend ───────────────────────
/**
 * The nsfwjs model type is intentionally loose: we dynamically import the lib so
 * its types aren't a hard build dependency of this module (the integrator adds
 * the dep). `classify` returns `[{ className, probability }]`.
 */
interface NsfwModelLike {
  classify(
    input: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
    topk?: number,
  ): Promise<Array<{ className: string; probability: number }>>;
  dispose?: () => void;
}

/**
 * Optional override for where the model weights are hosted. When unset, nsfwjs
 * loads its bundled default (MobileNetV2). Some bundlers serve the default model
 * from a CDN; setting this to a path you host yourself keeps it same-origin and
 * CSP-friendly. Wired from `NEXT_PUBLIC_NSFW_MODEL_URL` by the consumer.
 */
function modelUrl(): string | undefined {
  const fromEnv = process.env.NEXT_PUBLIC_NSFW_MODEL_URL;
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

/** A classifier that has already given up — always reports `safe`. */
const NOOP_CLASSIFIER: NsfwClassifier = {
  classify: async () => SAFE_RESULT,
  dispose: () => undefined,
};

/**
 * The nsfwjs-backed classifier. Loads tfjs + the model lazily on first
 * `classify`. If loading fails it degrades to the no-op (returns `safe`),
 * recorded so we don't retry the heavy import on every frame.
 */
function createNsfwjsClassifier(): NsfwClassifier {
  let modelPromise: Promise<NsfwModelLike | null> | null = null;
  let loadFailed = false;

  async function getModel(): Promise<NsfwModelLike | null> {
    if (loadFailed) return null;
    if (!modelPromise) {
      modelPromise = (async () => {
        try {
          // Dynamic import keeps tfjs + the model out of the initial bundle.
          const [tf, nsfwjs] = await Promise.all([
            import('@tensorflow/tfjs'),
            import('nsfwjs'),
          ]);
          // Production mode trims tfjs's expensive dev-time tensor checks.
          try {
            (tf as unknown as { enableProdMode?: () => void }).enableProdMode?.();
          } catch {
            /* non-fatal */
          }
          const url = modelUrl();
          const model = url
            ? await nsfwjs.load(url)
            : await nsfwjs.load();
          return model as unknown as NsfwModelLike;
        } catch {
          loadFailed = true;
          return null;
        }
      })();
    }
    return modelPromise;
  }

  return {
    async classify(source) {
      try {
        const model = await getModel();
        if (!model) return SAFE_RESULT;
        // A frame with no intrinsic size (camera warming up) classifies to junk.
        if (
          source instanceof HTMLVideoElement &&
          (source.videoWidth === 0 || source.videoHeight === 0)
        ) {
          return SAFE_RESULT;
        }
        const predictions = await model.classify(source);
        const raw: Partial<Record<NsfwClassName, number>> = {};
        for (const p of predictions) {
          raw[p.className as NsfwClassName] = p.probability;
        }
        return mapPredictions(raw);
      } catch {
        // A single frame failing must never break the call loop.
        return SAFE_RESULT;
      }
    },
    dispose() {
      // Dispose the loaded model if it exists; never block on the import.
      void modelPromise?.then((m) => {
        try {
          m?.dispose?.();
        } catch {
          /* ignore */
        }
      });
      modelPromise = null;
    },
  };
}

// ─────────────────────────────── Factory wiring ───────────────────────────
type ClassifierFactory = () => NsfwClassifier;

let factory: ClassifierFactory = createNsfwjsClassifier;

/**
 * Swap the classifier backend (tests, a different model, or a hard no-op).
 * Call once before a session starts.
 */
export function setClassifierFactory(next: ClassifierFactory): void {
  factory = next;
}

/** Construct a fresh classifier instance using the configured backend. */
export function createClassifier(): NsfwClassifier {
  return factory();
}

/** A no-op classifier factory (screening disabled). Exposed for explicit opt-out. */
export function noopClassifierFactory(): NsfwClassifier {
  return NOOP_CLASSIFIER;
}

export { SAFE_RESULT };
