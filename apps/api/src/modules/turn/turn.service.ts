import { createHmac } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * One ICE server entry as consumed by the browser's
 * `new RTCPeerConnection({ iceServers })`. STUN entries carry no credentials;
 * TURN entries carry the ephemeral `username`/`credential` pair.
 */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** Response of {@link TurnService.mintCredentials} (the `/turn/credentials` body). */
export interface TurnCredentials {
  iceServers: IceServer[];
  /** Unix epoch (seconds) at which the TURN credential stops being valid. */
  ttlExpiresAt: number;
}

/**
 * Default lifetime (seconds) of a minted TURN credential (20 min). Deliberately
 * short: the client fetches a fresh credential per call, so 20 min comfortably
 * covers ICE gathering + call setup while keeping a leaked credential's window
 * small. Override via `TURN_CRED_TTL_SECONDS`.
 */
const DEFAULT_TURN_TTL_SECONDS = 1200;

/**
 * Mints short-lived WebRTC ICE configuration for the client.
 *
 * Uses coturn's `use-auth-secret` (REST API / time-limited credential) scheme:
 * a single shared `TURN_STATIC_AUTH_SECRET` lives only server-side; per-call we
 * derive an ephemeral credential bound to the user id and an expiry timestamp:
 *
 * ```
 * expiry     = now_unix + ttl
 * username   = `${expiry}:${userId}`
 * credential = base64( HMAC_SHA1(TURN_STATIC_AUTH_SECRET, username) )
 * ```
 *
 * coturn re-derives the same HMAC from the username and rejects it once the
 * embedded timestamp passes, so credentials self-expire and require no
 * per-user database state. STUN urls are returned alongside (no credentials).
 *
 * The secret is NEVER sent to the client — only the derived credential is.
 */
@Injectable()
export class TurnService {
  private readonly logger = new Logger(TurnService.name);
  private readonly staticAuthSecret: string;
  private readonly ttlSeconds: number;
  private readonly turnUrls: string[];
  private readonly stunUrls: string[];
  /**
   * Whether a real TURN signing secret is configured. When `false` we MUST NOT
   * mint a credential (an HMAC over an empty secret is a bogus credential coturn
   * will reject) — we degrade to STUN-only instead, which still lets non-symmetric
   * NATs connect directly. Computed once at construction.
   */
  private readonly configured: boolean;

  constructor(config: ConfigService) {
    this.staticAuthSecret = config.get<string>('TURN_STATIC_AUTH_SECRET', '').trim();
    this.ttlSeconds = config.get<number>('TURN_CRED_TTL_SECONDS', DEFAULT_TURN_TTL_SECONDS);
    this.turnUrls = this.buildTurnUrls(config);
    this.stunUrls = this.buildStunUrls(config);
    this.configured = this.staticAuthSecret.length > 0;

    if (!this.configured) {
      // Degrade gracefully (STUN-only) rather than mint a bogus credential — but
      // be LOUD about it, because calls behind symmetric NATs/firewalls will fail
      // to connect with no relay. In production this is almost certainly a
      // misconfiguration, so log at error level (a crash-on-boot would take the
      // whole API down for a non-fatal gap, so we don't throw).
      const message =
        'TURN_STATIC_AUTH_SECRET is not set — serving STUN-only ICE config; calls behind ' +
        'symmetric NATs/firewalls will fail to connect. Configure a TURN relay for production.';
      if (config.get<string>('NODE_ENV') === 'production') {
        this.logger.error(message);
      } else {
        this.logger.warn(message);
      }
    }
  }

  /**
   * Mint an ICE-server configuration for the given user. The TURN entry's
   * credential is valid for {@link ttlSeconds} from now; the web client should
   * fetch a fresh set before that window elapses (the call overlay typically
   * re-fetches per call).
   */
  mintCredentials(userId: string): TurnCredentials {
    const expiry = Math.floor(Date.now() / 1000) + this.ttlSeconds;

    const iceServers: IceServer[] = [];
    if (this.stunUrls.length > 0) {
      iceServers.push({ urls: this.stunUrls });
    }
    // Only advertise a TURN relay when a real signing secret is configured:
    // signing with an empty secret yields a credential coturn will reject, so a
    // misconfigured deployment would advertise a relay that never authenticates.
    // When unconfigured we degrade to STUN-only (returned above) instead.
    if (this.configured && this.turnUrls.length > 0) {
      const username = `${expiry}:${userId}`;
      const credential = this.sign(username);
      iceServers.push({ urls: this.turnUrls, username, credential });
    }

    return { iceServers, ttlExpiresAt: expiry };
  }

  /** base64( HMAC-SHA1(secret, username) ) — coturn's expected credential form. */
  private sign(username: string): string {
    return createHmac('sha1', this.staticAuthSecret).update(username).digest('base64');
  }

  /**
   * TURN urls advertised to the client. Prefer an explicit `NEXT_PUBLIC_TURN_URLS`
   * (comma-separated, already in `turn:host:port` form) and fall back to building
   * UDP/TCP + TLS urls from `TURN_HOST` / `TURN_PORT` / `TURN_TLS_PORT`.
   */
  private buildTurnUrls(config: ConfigService): string[] {
    const explicit = this.splitCsv(config.get<string>('NEXT_PUBLIC_TURN_URLS'));
    if (explicit.length > 0) {
      return explicit;
    }
    const host = config.get<string>('TURN_HOST', 'localhost');
    const port = config.get<number>('TURN_PORT', 3478);
    const tlsPort = config.get<number>('TURN_TLS_PORT', 5349);
    return [`turn:${host}:${port}`, `turns:${host}:${tlsPort}`];
  }

  /**
   * STUN urls advertised to the client. Prefer `NEXT_PUBLIC_STUN_URLS`, else
   * derive `stun:TURN_HOST:TURN_PORT` (coturn serves STUN on the same port).
   */
  private buildStunUrls(config: ConfigService): string[] {
    const explicit = this.splitCsv(config.get<string>('NEXT_PUBLIC_STUN_URLS'));
    if (explicit.length > 0) {
      return explicit;
    }
    const host = config.get<string>('TURN_HOST', 'localhost');
    const port = config.get<number>('TURN_PORT', 3478);
    return [`stun:${host}:${port}`];
  }

  /** Split a comma-separated env value into trimmed, non-empty entries. */
  private splitCsv(value: string | undefined): string[] {
    return (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
}
