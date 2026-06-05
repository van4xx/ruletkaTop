import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type { AdminSettingFlag } from '@ruletka/shared-types';

import { AppSetting, AppSettingDocument } from './schemas/app-setting.schema';

/**
 * Definition of a LIVE, store-backed operational flag.
 *
 * These flags are NOT env-baked: they default to a code constant and are
 * overridden by a row in `app_settings`, so an admin can flip them at runtime
 * (no restart). The allow-list is the single source of truth for which keys
 * `SettingsService.set` will accept — a PATCH for any other key is rejected, so
 * the store can never shadow a secret or a build-time (NEXT_PUBLIC_*) constant.
 */
export interface LiveFlagDef {
  key: string;
  label: string;
  /** Default when no override row exists. */
  defaultValue: boolean;
}

/**
 * The runtime-toggleable operational flags. Kept intentionally small and
 * operational — a future consumer can read these live (e.g. a maintenance gate
 * or a registration kill-switch) without an API restart.
 */
export const LIVE_FLAGS: readonly LiveFlagDef[] = [
  {
    key: 'MAINTENANCE_MODE',
    label: 'Режим обслуживания (баннер)',
    defaultValue: false,
  },
  {
    key: 'REGISTRATION_OPEN',
    label: 'Регистрация открыта',
    defaultValue: true,
  },
  {
    key: 'MATCHMAKING_ENABLED',
    label: 'Подбор собеседника включён',
    defaultValue: true,
  },
];

const LIVE_FLAG_BY_KEY = new Map(LIVE_FLAGS.map((f) => [f.key, f] as const));

/**
 * The runtime feature-flag store introduced in WAVE-2.
 *
 * Owns the `app_settings` collection: a small persisted key/value store that
 * backs the LIVE (no-restart) subset of the admin settings surface. The
 * env-derived flags stay in {@link AdminSettingsService}; this service supplies
 * the merge layer (`getAll` = code defaults ⊕ stored overrides) and the
 * validated, audited `set`.
 *
 * Writes are guarded by {@link LIVE_FLAGS}: a key not on the allow-list is
 * refused, so a PATCH can never persist an arbitrary / secret key.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectModel(AppSetting.name) private readonly settingModel: Model<AppSettingDocument>,
  ) {}

  /** Whether `key` is a known, runtime-toggleable (store-backed) flag. */
  isLiveKey(key: string): boolean {
    return LIVE_FLAG_BY_KEY.has(key);
  }

  /**
   * The full set of LIVE flags as contract shapes: each code default merged with
   * its stored override (if any). `source: 'runtime'`, `requiresRestart: false`.
   */
  async getAll(): Promise<AdminSettingFlag[]> {
    const overrides = await this.loadOverrides();
    return LIVE_FLAGS.map((def) => ({
      key: def.key,
      label: def.label,
      value: overrides.has(def.key) ? overrides.get(def.key)! : def.defaultValue,
      source: 'runtime' as const,
      requiresRestart: false,
    }));
  }

  /**
   * Persist (upsert) a LIVE flag override. Coerces the value to the flag's type
   * (these are all booleans today). Returns `true` when applied; `false` when the
   * key is not a known live flag (caller surfaces the "needs restart" note).
   */
  async set(
    key: string,
    value: boolean | number | string,
    actorId?: string | null,
  ): Promise<boolean> {
    const def = LIVE_FLAG_BY_KEY.get(key);
    if (!def) {
      return false;
    }

    // All live flags are boolean today — coerce defensively so a stray
    // "false"/0 string can't persist a truthy value.
    const coerced = this.coerceBool(value);

    await this.settingModel.updateOne(
      { key },
      {
        $set: {
          value: coerced,
          updatedBy:
            actorId && Types.ObjectId.isValid(actorId) ? new Types.ObjectId(actorId) : null,
        },
      },
      { upsert: true },
    );
    return true;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Load all stored overrides as a `key → value` map (best-effort). */
  private async loadOverrides(): Promise<Map<string, boolean | number | string>> {
    try {
      const rows = await this.settingModel.find({}, { key: 1, value: 1 }).lean().exec();
      return new Map(rows.map((r) => [r.key, r.value as boolean | number | string]));
    } catch (err) {
      // A store read failure must not break the settings page — fall back to
      // code defaults (empty overrides).
      this.logger.error(`Failed to read app_settings overrides: ${(err as Error).message}`);
      return new Map();
    }
  }

  /** Coerce a mixed flag value to a boolean (truthy strings/numbers → true). */
  private coerceBool(value: boolean | number | string): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    return value.trim().toLowerCase() === 'true';
  }
}
