import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { AppNotification } from '@ruletka/shared-types';

import type { PushSendResult, MobilePushProvider } from './push.types';

/**
 * Minimal interface over the bit of `google-auth-library` we use: a JWT client
 * minted from a service account that hands us short-lived OAuth2 access tokens
 * (cached + auto-refreshed internally). Typed narrowly so this file does not
 * depend on the library's full surface and the keyless path needs no import.
 */
interface JwtClient {
  getAccessToken(): Promise<{ token?: string | null }>;
}

/** OAuth2 scope required to call the FCM HTTP v1 `messages:send` endpoint. */
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/**
 * FCM error statuses (the `error.status` / `error.details[].errorCode` of a
 * `messages:send` response) that mean the registration token is permanently
 * dead and should be pruned from storage. `UNREGISTERED` (the app was
 * uninstalled / the token rotated) and `NOT_FOUND` map to HTTP 404;
 * `INVALID_ARGUMENT` (HTTP 400) covers a malformed/garbage token we can never
 * deliver to. Everything else (auth, quota, 5xx) is transient → log + keep.
 */
const GONE_FCM_STATUSES = new Set(['UNREGISTERED', 'NOT_FOUND', 'INVALID_ARGUMENT']);

/** The decoded Google service-account JSON fields we rely on. */
interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/**
 * No-op mobile push provider used when no Firebase credentials are configured
 * (the default). The notification is still persisted + delivered in-app over the
 * socket; only the native (FCM/APNs) fan-out is skipped — so the app runs without
 * cloud-messaging secrets in dev/CI.
 */
export class NoopMobilePushProvider implements MobilePushProvider {
  readonly enabled = false;

  async send(): Promise<PushSendResult> {
    return { ok: false, gone: false };
  }
}

/**
 * Real mobile push provider backed by FCM HTTP v1.
 *
 * Mints an OAuth2 access token from the service account (via the injected
 * {@link JwtClient}, which caches + refreshes it) and POSTs one message per
 * device token to
 * `https://fcm.googleapis.com/v1/projects/<projectId>/messages:send`. The same
 * domain {@link AppNotification} the Web Push side carries becomes the FCM
 * `notification` (title/body) + a small `data` map (id/kind/link) the mobile app
 * reads to deep-link a tap.
 *
 * A `404 UNREGISTERED`/`NOT_FOUND` (or a `400 INVALID_ARGUMENT`) marks the token
 * `gone` so the {@link PushService} prunes the dead row — identical contract to
 * the Web Push side. Transient failures (auth, quota, 5xx) are logged and the
 * token is kept for the next fan-out.
 */
export class FcmMobilePushProvider implements MobilePushProvider {
  readonly enabled = true;
  private readonly logger = new Logger(FcmMobilePushProvider.name);
  private readonly endpoint: string;

  constructor(
    private readonly jwt: JwtClient,
    private readonly projectId: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  }

  async send(token: string, notification: AppNotification): Promise<PushSendResult> {
    let accessToken: string | null | undefined;
    try {
      ({ token: accessToken } = await this.jwt.getAccessToken());
    } catch (err) {
      // Could not mint a token (bad key, clock skew, network) — transient by
      // nature; never prune on an auth failure.
      this.logger.warn(`FCM access-token mint failed: ${asMessage(err)}`);
      return { ok: false, gone: false };
    }
    if (!accessToken) {
      this.logger.warn('FCM access-token mint returned empty token.');
      return { ok: false, gone: false };
    }

    try {
      const res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: buildFcmMessage(token, notification) }),
      });

      if (res.ok) {
        return { ok: true, gone: false };
      }

      const status = extractFcmStatus(await safeReadJson(res));
      const gone = (status !== null && GONE_FCM_STATUSES.has(status)) || res.status === 404;
      if (!gone) {
        this.logger.warn(
          `FCM send failed (http=${res.status}, status=${status ?? '?'}) for token …${tail(token)}`,
        );
      }
      return { ok: false, gone };
    } catch (err) {
      // Network/transport error — transient; keep the token.
      this.logger.warn(`FCM send threw for token …${tail(token)}: ${asMessage(err)}`);
      return { ok: false, gone: false };
    }
  }
}

/**
 * Build the FCM HTTP v1 `message` body for one device token. The notification
 * (title/body) renders the system tray entry; the `data` map carries the deep
 * link + id/kind as strings (FCM `data` values MUST be strings) so a tap can
 * route to the canonical `/chats/:id` (or other) target on the device.
 */
function buildFcmMessage(token: string, n: AppNotification): Record<string, unknown> {
  const data: Record<string, string> = {
    id: n.id,
    kind: n.kind,
    createdAt: n.createdAt,
  };
  const link = (n as { link?: string | null }).link;
  if (link) {
    data.link = link;
  }
  return {
    token,
    notification: { title: n.title, body: n.body },
    data,
    android: { priority: 'high' },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: { aps: { sound: 'default' } },
    },
  };
}

/**
 * Pull the stable error status from a parsed FCM error body. FCM v1 nests the
 * token-specific reason under `error.details[].errorCode` (a `FcmError` detail)
 * and also exposes a coarser `error.status`. We prefer the specific detail.
 */
function extractFcmStatus(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== 'object') {
    return null;
  }
  const details = (error as { details?: unknown }).details;
  if (Array.isArray(details)) {
    for (const detail of details) {
      const code = (detail as { errorCode?: unknown })?.errorCode;
      if (typeof code === 'string' && code) {
        return code;
      }
    }
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === 'string' ? status : null;
}

/** Parse a Response body as JSON, swallowing parse errors (returns `null`). */
async function safeReadJson(res: { json(): Promise<unknown> }): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Last 8 chars of a token, for safe-to-log identification. */
function tail(token: string): string {
  return token.length <= 8 ? token : token.slice(-8);
}

/** Narrows an unknown thrown value to a printable message. */
function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Decode `FIREBASE_SERVICE_ACCOUNT` (raw JSON or base64-encoded JSON) into the
 * fields we need. Returns `null` if it is blank, unparseable, or missing a
 * required field — the caller then falls back to the no-op (never throws).
 */
export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw || !raw.trim()) {
    return null;
  }
  const trimmed = raw.trim();
  // Accept either raw JSON (starts with `{`) or base64 of the JSON.
  const json = trimmed.startsWith('{')
    ? trimmed
    : (() => {
        try {
          return Buffer.from(trimmed, 'base64').toString('utf8');
        } catch {
          return '';
        }
      })();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const { project_id, client_email, private_key } = parsed as Record<string, unknown>;
  if (
    typeof project_id !== 'string' ||
    typeof client_email !== 'string' ||
    typeof private_key !== 'string' ||
    !project_id ||
    !client_email ||
    !private_key
  ) {
    return null;
  }
  // A PEM pasted through an env var often has literal `\n` — normalise so the
  // JWT signer gets real newlines.
  return { project_id, client_email, private_key: private_key.replace(/\\n/g, '\n') };
}

/**
 * Build the mobile push provider for the DI container. Returns the real FCM
 * HTTP v1 provider when `FIREBASE_SERVICE_ACCOUNT` is set to a valid service
 * account (raw JSON or base64) AND `google-auth-library` is installed; otherwise
 * a keyless no-op. NEVER throws: a missing dependency or bad credential only
 * degrades to the no-op so boot can't fail on it (mirrors the Web Push side).
 */
export function resolveMobilePushProvider(config: ConfigService): MobilePushProvider {
  const logger = new Logger('MobilePushProvider');
  const raw = config.get<string>('FIREBASE_SERVICE_ACCOUNT');
  const account = parseServiceAccount(raw);
  if (!account) {
    if (raw && raw.trim()) {
      // Set but unusable — warn loudly so a typo'd credential isn't silent.
      logger.warn('FIREBASE_SERVICE_ACCOUNT set but invalid (not JSON/base64 of a service account) — mobile push disabled.');
    } else {
      logger.log('Firebase creds not set — mobile push disabled (in-app + socket only).');
    }
    return new NoopMobilePushProvider();
  }
  try {
    // Lazy require so the package is only needed when actually enabled (mirrors
    // the optional `web-push` require on the Web Push side).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { JWT } = require('google-auth-library') as {
      JWT: new (opts: { email: string; key: string; scopes: string | string[] }) => JwtClient;
    };
    const jwt = new JWT({
      email: account.client_email,
      key: account.private_key,
      scopes: FCM_SCOPE,
    });
    logger.log(`Mobile push enabled (FCM HTTP v1, project ${account.project_id}).`);
    return new FcmMobilePushProvider(jwt, account.project_id);
  } catch (err) {
    logger.warn(
      `FIREBASE_SERVICE_ACCOUNT set but 'google-auth-library' unavailable — mobile push disabled: ${asMessage(err)}`,
    );
    return new NoopMobilePushProvider();
  }
}
