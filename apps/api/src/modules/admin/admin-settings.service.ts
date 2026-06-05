import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  AdminPatchSettingsDto,
  AdminPatchSettingsResult,
  AdminSettingFlag,
  AdminSettings,
} from '@ruletka/shared-types';

import { SettingsService } from './settings.service';

/** Default per-IP throttle ceilings (mirror `throttler.constants`). */
const DEFAULT_THROTTLE_LIMIT = 120;
const DEFAULT_AUTH_THROTTLE_LIMIT = 10;

/**
 * Admin settings surface.
 *
 * READ — REAL: presents BOTH layers as one typed list —
 *  - env/config-derived flags + throttle limits (e.g. FINGERPRINT_BAN_ENABLED,
 *    TURNSTILE_SECRET presence, THROTTLE_LIMIT/AUTH_THROTTLE_LIMIT, moderation/
 *    push/payments provider presence). `source: 'env'`, `requiresRestart: true`
 *    — changing them needs an API restart/rebuild. Secrets are reported as a
 *    boolean "configured" flag only — never echoed.
 *  - the LIVE, store-backed operational flags from {@link SettingsService}
 *    (`source: 'runtime'`, `requiresRestart: false`) — toggleable at runtime.
 *
 * PATCH — REAL for live keys (WAVE-2): a key on the {@link SettingsService}
 * allow-list is PERSISTED to the `app_settings` store and takes effect
 * immediately. An env-baked key is refused with a "requires restart/rebuild"
 * note (you can't flip an env var at runtime), so the response always says
 * clearly whether the change is live now or needs a restart.
 */
@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly config: ConfigService,
    private readonly settingsStore: SettingsService,
  ) {}

  /** The feature-flag + throttle-limit snapshot (env layer ⊕ live store layer). */
  async getSettings(): Promise<AdminSettings> {
    const envFlags: AdminSettingFlag[] = [
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

    // Live, store-backed operational flags (toggleable without a restart).
    const liveFlags = await this.settingsStore.getAll();

    // Live flags first so the toggleable controls lead the page.
    return { flags: [...liveFlags, ...envFlags] };
  }

  /**
   * Persist a flag.
   *  - LIVE (store-backed) key → upsert into `app_settings`, takes effect now.
   *  - env-baked / unknown key → not applied; returns a "requires restart" note.
   */
  async patchSettings(
    dto: AdminPatchSettingsDto,
    actorId?: string | null,
  ): Promise<AdminPatchSettingsResult> {
    if (this.settingsStore.isLiveKey(dto.key)) {
      await this.settingsStore.set(dto.key, dto.value, actorId);
      return {
        key: dto.key,
        applied: true,
        note: 'Флаг сохранён и применён сразу (рантайм-настройка, перезапуск не нужен).',
      };
    }

    return {
      key: dto.key,
      applied: false,
      note: 'Флаг задаётся через переменные окружения — для применения нужен перезапуск/пересборка API.',
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
