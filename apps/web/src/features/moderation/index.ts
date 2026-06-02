/**
 * Trust & Safety — on-device NSFW screening, forced moderation-action handling,
 * and the admin review surface.
 *
 * Public surface consumed by the call UI (roulette stage) and the admin page.
 */
export {
  createClassifier,
  setClassifierFactory,
  noopClassifierFactory,
  type NsfwClassifier,
  type ClassificationResult,
  type NsfwClassName,
} from './classifier';
export { THRESHOLDS, SAMPLE_INTERVAL_MS, VIOLATION_COOLDOWN_MS, evaluate } from './policy';
export { drawDownscaledFrame, canvasToEvidence } from './capture';
export { moderationApi, moderationKeys, type ReviewResolution } from './api';
export {
  useLocalScreening,
  type LocalScreeningOptions,
  type LocalScreeningResult,
} from './use-local-screening';
export { useModerationAction, type UseModerationActionOptions } from './use-moderation-action';
export { useReviewQueue, useResolveReview, type ResolveVars } from './use-review-queue';
