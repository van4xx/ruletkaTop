import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  AdminPatchSettingsDto,
  AdminPatchSettingsResult,
  AdminSettingFlag,
  AdminSettings,
} from '@ruletka/shared-types';

/** Default per-IP throttle ceilings (mirror `throttler.constants`). */
const DEFAULT_THROTTLE_LIMIT = 120;
const DEFAULT_AUTH_THROTTLE_LIMIT = 10;

/**
 * Admin settings surface.
 *
 * READ — REAL: presents the platform's env/config-derived feature flags +
 * throttle limits (e.g. FINGERPRINT_BAN_ENABLED, TURNSTILE_SECRET presence,
 * THROTTLE_LIMIT/AUTH_THROTTLE_LIMIT, moderation/push provider presence) as a
 * typed list. Values are read via {@link ConfigService}; secrets are reported as
 * a boolean "configured" flag only — never echoed.
 *
 * PATCH — STUB: the flags here are env-based, so changing them needs an API
 * restart. The patch endpoint validates + records intent and returns a note;
 * Wave-2 introduces a runtime feature-flag store for live toggles. // TODO(wave2)
 */
@Injectable()
export class AdminSettingsService {
  constructor(private readonly config: ConfigService) {}

  /** The feature-flag + throttle-limit snapshot. */
  getSettings(): AdminSettings {
    const flags: AdminSettingFlag[] = [
      {
        key: 'FINGERPRINT_BAN_ENABLED',
        label: 'Бан по отпечатку устройства',
        value: this.boolEnv('FINGERPRINT_BAN_ENABLED'),
        source: 'env',
        requiresRestart: true,
      },
      {
        key: 'CAPTCHA_ENABLED',
        label: 'CAPTCHA при регистрации (Turnstile)',
        value: this.isConfigured('TURNSTILE_SECRET'),
        source: 'env',
        requiresRestart: true,
      },
      {
        key: 'MODERATION_PROVIDER_ENABLED',
        label: 'AI-модерация кадров (провайдер)',
        value: this.isConfigured('MODERATION_PROVIDER_API_KEY'),
        source: 'env',
        requiresRestart: true,
      },
      {
        key: 'WEB_PUSH_ENABLED',
        label: 'Web Push (VAPID)',
        value: this.isConfigured('VAPID_PRIVATE_KEY'),
        source: 'env',
        requiresRestart: true,
      },
      {
        key: 'PAYMENTS_ENABLED',
        label: 'Платежи (CloudPayments)',
        value: this.isConfigured('CLOUDPAYMENTS_API_SECRET'),
        source: 'env',
        requiresRestart: true,
      },
      {
        key: 'THROTTLE_LIMIT',
        label: 'Лимит запросов / IP / мин',
        value: this.intEnv('THROTTLE_LIMIT', DEFAULT_THROTTLE_LIMIT),
        source: 'env',
        requiresRestart: true,
      },
      {
        key: 'AUTH_THROTTLE_LIMIT',
        label: 'Лимит авторизации / IP / мин',
        value: this.intEnv('AUTH_THROTTLE_LIMIT', DEFAULT_AUTH_THROTTLE_LIMIT),
        source: 'env',
        requiresRestart: true,
      },
    ];

    return { flags };
  }

  /**
   * STUB — env flags can't be flipped at runtime. Validates the key + returns a
   * note that a restart is required. Does NOT mutate anything. // TODO(wave2)
   */
  patchSettings(dto: AdminPatchSettingsDto): AdminPatchSettingsResult {
    // TODO(wave2): back runtime-toggleable flags with a persisted feature-flag
    // store so a subset of these can change without a restart.
    return {
      key: dto.key,
      applied: false,
      note: 'Флаг задаётся через переменные окружения — для применения нужен перезапуск API.',
    };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** True when an env var is set to a truthy string. */
  private boolEnv(key: string): boolean {
    return String(this.config.get<string>(key) ?? '').toLowerCase() === 'true';
  }

  /** Parse an int env var, falling back to `fallback`. */
  private intEnv(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    if (raw === undefined) {
      return fallback;
    }
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  /** True when a secret is present + non-blank (never echoes the value). */
  private isConfigured(key: string): boolean {
    return (this.config.get<string>(key) ?? '').trim().length > 0;
  }
}
