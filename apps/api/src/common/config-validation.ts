import type { ConfigService } from '@nestjs/config';
import type { LoggerService } from '@nestjs/common';

/**
 * Startup secrets guard — FAIL-FAST in production, advisory in dev/test.
 *
 * Called once during bootstrap (BEFORE `app.listen()`), this asserts that the
 * CRITICAL secrets the app cannot safely run without in production are both
 * PRESENT and not left at a shipped placeholder. A violation throws, aborting
 * boot before the server ever accepts a request — far safer than silently
 * coming up with a guessable JWT signing key.
 *
 * Optional-but-recommended integrations (payments, TURN, email, web-push) only
 * emit a WARN: the app degrades gracefully without them (no-op mail, no push,
 * relay-only TURN), so a missing value should be loud but not fatal.
 *
 * SECURITY: this NEVER reads back, logs, or compares against a real secret
 * VALUE beyond the small set of well-known shipped placeholders — only
 * presence (`isBlank`) and placeholder identity are checked, and only the
 * env-var NAME is ever logged. Enforcement is gated on `NODE_ENV=production`
 * so dev/test/CI (which legitimately run with the `.env.example` defaults)
 * are never blocked.
 */

/**
 * Critical secrets that MUST be set (and non-placeholder) in production. The
 * app signs/verifies auth tokens with these; a missing or guessable value is a
 * full auth bypass, so their absence is fatal.
 *
 * Both JWT secrets are required: `JWT_ACCESS_SECRET` signs/verifies access
 * tokens (CommonModule + JwtStrategy) and `JWT_REFRESH_SECRET` signs/verifies
 * the refresh token (auth.service).
 */
const CRITICAL_SECRETS: readonly string[] = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

/**
 * Optional-but-recommended secrets, grouped by the capability they unlock. A
 * group is flagged only when EVERY var in it is unset/placeholder (a partially
 * configured group is still flagged so half-wired integrations surface). These
 * never block boot — the platform runs without them.
 */
const RECOMMENDED_GROUPS: ReadonlyArray<{ label: string; vars: readonly string[] }> = [
  {
    label: 'CloudPayments (coin top-ups)',
    vars: ['CLOUDPAYMENTS_PUBLIC_ID', 'CLOUDPAYMENTS_API_SECRET'],
  },
  { label: 'TURN relay auth (WebRTC behind strict NAT)', vars: ['TURN_STATIC_AUTH_SECRET'] },
  {
    label: 'SMTP email delivery (verification / reset)',
    vars: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'],
  },
  {
    label: 'Web Push / VAPID (browser notifications)',
    vars: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'],
  },
];

/**
 * Known placeholder values shipped in `.env.example`. A production secret left
 * equal to any of these is treated as "not configured". Case-insensitive, and a
 * generic `change-me*` / `your-*` / `xxx*` heuristic catches near-variants
 * without ever embedding a real secret here.
 */
const KNOWN_PLACEHOLDERS: readonly string[] = [
  'change-me-access-secret',
  'change-me-refresh-secret',
  'change-me-turn-secret',
  'changeme',
  'change-me',
];

/** True when a config value is missing or whitespace-only. */
function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

/**
 * True when a value is unset or is a recognised placeholder (exact known list,
 * or the generic `change-me*` / `your-*` / `xxx` shapes). Never logs the value.
 */
function isUnsetOrPlaceholder(value: string | undefined): boolean {
  if (isBlank(value)) {
    return true;
  }
  const v = (value as string).trim().toLowerCase();
  if (KNOWN_PLACEHOLDERS.includes(v)) {
    return true;
  }
  return (
    v.startsWith('change-me') || v.startsWith('changeme') || v.startsWith('your-') || v === 'xxx'
  );
}

/**
 * Validate critical + recommended secrets. In production, throws an `Error`
 * (aborting bootstrap) listing every critical secret that is missing or still a
 * placeholder. Outside production it is a no-op for the fatal path; the WARN for
 * recommended integrations is emitted in every environment so misconfig is
 * visible early without blocking.
 *
 * @throws Error when `NODE_ENV=production` and ≥1 critical secret is unset/placeholder.
 */
export function validateCriticalConfig(config: ConfigService, logger: LoggerService): void {
  const isProd = config.get<string>('NODE_ENV') === 'production';

  // ── Recommended integrations: WARN only (every environment) ──────────────
  for (const group of RECOMMENDED_GROUPS) {
    const allMissing = group.vars.every((name) => isUnsetOrPlaceholder(config.get<string>(name)));
    if (allMissing) {
      logger.warn?.(
        `Optional integration not configured: ${group.label}. ` +
          `Set ${group.vars.join(' / ')} to enable it (the app runs without it).`,
        'ConfigValidation',
      );
    }
  }

  // ── Critical secrets: only ENFORCED in production ────────────────────────
  if (!isProd) {
    return;
  }

  const offenders = CRITICAL_SECRETS.filter((name) =>
    isUnsetOrPlaceholder(config.get<string>(name)),
  );

  if (offenders.length > 0) {
    // Name the offending vars only — never their values.
    const message =
      `FATAL: ${offenders.length} critical secret(s) are missing or still set to a ` +
      `placeholder in production: ${offenders.join(', ')}. ` +
      `Set a strong, unique value for each before starting the API. Refusing to boot.`;
    logger.error?.(message, undefined, 'ConfigValidation');
    throw new Error(message);
  }

  logger.log?.('Critical secrets present and non-placeholder.', 'ConfigValidation');
}
