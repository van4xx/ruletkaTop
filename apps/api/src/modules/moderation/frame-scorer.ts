import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { ModerationLabel } from '@ruletka/shared-types';

/** DI token for the active {@link FrameScorer} implementation. */
export const FRAME_SCORER = 'FRAME_SCORER';

/** Result of scoring a single frame: the dominant label + confidence in [0,1]. */
export interface FrameScore {
  label: ModerationLabel;
  /** Classifier confidence in [0,1]. */
  score: number;
}

/**
 * Pluggable server-side frame classifier.
 *
 * The PRIMARY moderation signal is the on-device classifier in the client (it
 * blurs locally and reports a {@link ModerationViolationDto}); this interface is
 * the optional SERVER-SIDE spot-check / second opinion on the evidence frame.
 *
 * Implementations MUST be safe to call with an absent/garbage frame and MUST NOT
 * throw — return `{ label: 'safe', score: 0 }` when they cannot classify.
 */
export interface FrameScorer {
  /**
   * Classify an evidence frame. `evidenceDataUrl` is a (downscaled) JPEG
   * data-URL or `undefined` when the client sent no frame.
   */
  score(evidenceDataUrl: string | undefined): Promise<FrameScore>;
}

/**
 * Default scorer: a no-op that classifies everything as `safe` with score 0.
 *
 * With this active the server performs NO independent classification and simply
 * trusts the client-reported violation (the app compiles and runs with zero
 * third-party keys). Select a real provider via the `FRAME_SCORER` env var.
 */
@Injectable()
export class NoOpFrameScorer implements FrameScorer {
  async score(_evidenceDataUrl: string | undefined): Promise<FrameScore> {
    return { label: 'safe', score: 0 };
  }
}

// ── Sightengine wire types + tunables ────────────────────────────────────────

/** Sightengine `check.json` endpoint (synchronous image moderation). */
const SIGHTENGINE_ENDPOINT = 'https://api.sightengine.com/1.0/check.json';

/**
 * Models requested by default. `nudity-2.1` returns graded sexual/suggestive
 * probabilities; `gore-2.0` returns a graphic-violence probability. Overridable
 * via `SIGHTENGINE_MODELS` so ops can add/remove models without a code change.
 */
const DEFAULT_SIGHTENGINE_MODELS = 'nudity-2.1,gore-2.0';

/**
 * Below this probability the frame is treated as `safe`/0 (avoids surfacing
 * benign noise as a weak non-`safe` signal, which `mergeSignals` could otherwise
 * propagate). Tunable via `SIGHTENGINE_MIN_PROB`.
 */
const DEFAULT_MIN_PROB = 0.5;

/** Hard timeout (ms) for the provider call; fail-open on expiry. */
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Shape of the Sightengine `nudity-2.1` block we read. All values are
 * probabilities in [0,1]; extra fields (suggestive_classes, context, …) are
 * ignored. See https://sightengine.com/docs/advanced-nudity-detection-model-2.1
 */
interface SightengineNudity {
  sexual_activity?: number;
  sexual_display?: number;
  erotica?: number;
  very_suggestive?: number;
  suggestive?: number;
  mildly_suggestive?: number;
  none?: number;
}

/** Sightengine `gore-2.0` block (graphic violence). `prob` is the headline. */
interface SightengineGore {
  prob?: number;
}

/** Top-level Sightengine response envelope. */
interface SightengineResponse {
  status?: 'success' | 'failure';
  nudity?: SightengineNudity;
  gore?: SightengineGore;
  error?: { type?: string; code?: number; message?: string };
}

/** A candidate classification before we pick the dominant one. */
interface LabelCandidate {
  label: ModerationLabel;
  score: number;
}

/**
 * Env-gated REAL frame scorer backed by **Sightengine** (`check.json`).
 *
 * Ships DISABLED: without the provider credentials configured it behaves exactly
 * like {@link NoOpFrameScorer} (returns `safe`/0) so dev/CI run keyless. When
 * `SIGHTENGINE_API_USER` + `MODERATION_PROVIDER_API_KEY` (the api secret) are
 * set it decodes the evidence data-URL to bytes, POSTs them as multipart
 * `media`, and maps the provider's nudity/gore probabilities onto a contract
 * {@link ModerationLabel} + a [0,1] score.
 *
 * FAIL-OPEN: any provider error (network, timeout, non-2xx, `status:'failure'`,
 * malformed body) falls back to `safe`/0 and is LOGGED — a provider outage must
 * never block a call or mis-ban a user. The merge in `ModerationService` only
 * lets a confident, non-`safe` server result UPGRADE a client report, so a
 * fail-open `safe`/0 is always harmless.
 *
 * NOTE: this model set does not detect CSAM, so we never synthesize the
 * zero-tolerance `minor` label server-side; child-safety stays a client/manual
 * signal handled by the escalation policy.
 *
 * Selected by setting `FRAME_SCORER=provider` (see {@link resolveFrameScorer}).
 */
@Injectable()
export class ProviderFrameScorer implements FrameScorer {
  private readonly logger = new Logger(ProviderFrameScorer.name);
  /** Sightengine api_secret (kept on the legacy env name for compatibility). */
  private readonly apiSecret: string;
  /** Sightengine api_user. */
  private readonly apiUser: string;
  private readonly models: string;
  private readonly minProb: number;
  private warnedOnce = false;

  constructor(config: ConfigService) {
    // api_secret reuses the existing generic provider-key env name.
    this.apiSecret = config.get<string>('MODERATION_PROVIDER_API_KEY', '');
    this.apiUser = config.get<string>('SIGHTENGINE_API_USER', '');
    this.models = config.get<string>('SIGHTENGINE_MODELS', DEFAULT_SIGHTENGINE_MODELS);
    // NOTE: `Number('') === 0` (not NaN), so an UNSET var must be treated as
    // empty FIRST — otherwise the threshold would silently collapse to 0 and
    // flag every non-zero signal.
    const rawMin = config.get<string>('SIGHTENGINE_MIN_PROB', '').trim();
    const parsedMin = rawMin === '' ? Number.NaN : Number(rawMin);
    this.minProb =
      Number.isFinite(parsedMin) && parsedMin >= 0 && parsedMin <= 1 ? parsedMin : DEFAULT_MIN_PROB;
  }

  /** True only when BOTH Sightengine credentials are configured. */
  private get configured(): boolean {
    return Boolean(this.apiUser && this.apiSecret);
  }

  async score(evidenceDataUrl: string | undefined): Promise<FrameScore> {
    if (!this.configured) {
      // Not configured → behave as the no-op default (warn exactly once).
      if (!this.warnedOnce) {
        this.warnedOnce = true;
        this.logger.warn(
          'ProviderFrameScorer selected but Sightengine credentials are unset ' +
            '(need SIGHTENGINE_API_USER + MODERATION_PROVIDER_API_KEY); ' +
            'falling back to safe/0 (no server-side classification).',
        );
      }
      return safe();
    }

    // Nothing to classify → safe (not an error).
    if (!evidenceDataUrl) {
      return safe();
    }

    const bytes = decodeDataUrl(evidenceDataUrl);
    if (!bytes) {
      this.logger.warn('frame scorer: evidence is not a decodable data-URL; skipping.');
      return safe();
    }

    try {
      const result = await this.callSightengine(bytes.bytes, bytes.mime);
      return mapSightengineToFrameScore(result, this.minProb);
    } catch (err) {
      // FAIL-OPEN: never block a call on a provider outage — log + return safe/0.
      this.logger.warn(`frame scorer provider failed (fail-open): ${asMessage(err)}`);
      return safe();
    }
  }

  /** POST the frame bytes to Sightengine as multipart `media`; parse the body. */
  private async callSightengine(bytes: Uint8Array, mime: string): Promise<SightengineResponse> {
    const form = new FormData();
    // `Blob`/`FormData` are global in Node 18+ (typed via @types/node web-globals);
    // the Node `Blob` ctor accepts a `Uint8Array` source. The file part is `media`.
    form.append('media', new Blob([bytes], { type: mime }), 'frame.jpg');
    form.append('models', this.models);
    form.append('api_user', this.apiUser);
    form.append('api_secret', this.apiSecret);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(SIGHTENGINE_ENDPOINT, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });

      // Sightengine returns JSON even on logical errors; parse defensively.
      const body = (await res.json().catch(() => null)) as SightengineResponse | null;

      if (!res.ok) {
        const detail = body?.error?.message ?? `HTTP ${res.status}`;
        throw new Error(`sightengine non-2xx: ${detail}`);
      }
      if (!body || body.status !== 'success') {
        const detail = body?.error?.message ?? body?.error?.type ?? 'unknown';
        throw new Error(`sightengine status!=success: ${detail}`);
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Factory bound to {@link FRAME_SCORER}: selects the implementation from the
 * `FRAME_SCORER` env var. Defaults to the no-op so the service runs keyless.
 *
 *  - `FRAME_SCORER` unset / `noop` / `none` → {@link NoOpFrameScorer}
 *  - `FRAME_SCORER=provider`               → {@link ProviderFrameScorer}
 *    (Sightengine; itself a no-op until its credentials are set)
 */
export function resolveFrameScorer(config: ConfigService): FrameScorer {
  const selected = (config.get<string>('FRAME_SCORER', 'noop') || 'noop').toLowerCase();
  switch (selected) {
    case 'provider':
      return new ProviderFrameScorer(config);
    case 'noop':
    case 'none':
    case '':
      return new NoOpFrameScorer();
    default:
      // Unknown value ⇒ fail safe to the no-op rather than crashing on boot.
      return new NoOpFrameScorer();
  }
}

// ── Pure helpers (exported for unit testing the mapping in isolation) ─────────

/** Canonical "no signal" result. */
function safe(): FrameScore {
  return { label: 'safe', score: 0 };
}

/**
 * Decode a `data:` URL into raw bytes + mime. Returns `null` for anything that
 * is not a base64 image data-URL. Defensive: never throws.
 */
export function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const match = /^data:([\w/+.-]+);base64,([\s\S]+)$/i.exec(dataUrl.trim());
  // `noUncheckedIndexedAccess` types the groups as possibly-undefined; guard.
  const payload = match?.[2];
  if (!payload) {
    return null;
  }
  const mime = match?.[1] || 'application/octet-stream';
  try {
    const buf = Buffer.from(payload, 'base64');
    if (buf.length === 0) {
      return null;
    }
    return { bytes: new Uint8Array(buf), mime };
  } catch {
    return null;
  }
}

/**
 * Map a successful Sightengine response onto a single {@link FrameScore}.
 *
 * We build per-label candidates from the relevant probabilities and return the
 * single dominant one (highest score), provided it clears `minProb`; otherwise
 * `safe`/0. Grouping:
 *  - `sexual`   ← max(sexual_activity, sexual_display)
 *  - `nudity`   ← max(erotica, very_suggestive, suggestive)
 *  - `violence` ← gore.prob
 *
 * `mildly_suggestive`/`none` are intentionally ignored (too benign to act on).
 * Exported for unit tests.
 */
export function mapSightengineToFrameScore(res: SightengineResponse, minProb: number): FrameScore {
  const n = res.nudity ?? {};
  const candidates: LabelCandidate[] = [
    { label: 'sexual', score: maxProb(n.sexual_activity, n.sexual_display) },
    { label: 'nudity', score: maxProb(n.erotica, n.very_suggestive, n.suggestive) },
    { label: 'violence', score: prob(res.gore?.prob) },
  ];

  const top = candidates.reduce((best, c) => (c.score > best.score ? c : best), {
    label: 'safe' as ModerationLabel,
    score: 0,
  });

  if (top.score < minProb) {
    return safe();
  }
  return { label: top.label, score: clamp01(top.score) };
}

/** Coerce a possibly-undefined provider probability into a clamped [0,1]. */
function prob(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : 0;
}

/** Max of several possibly-undefined probabilities, clamped to [0,1]. */
function maxProb(...values: Array<number | undefined>): number {
  return values.reduce<number>((max, v) => Math.max(max, prob(v)), 0);
}

/** Clamp a number into the inclusive [0,1] range. */
function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Narrows an unknown thrown value to a printable message. */
function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
