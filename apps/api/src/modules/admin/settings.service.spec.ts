import type { Model } from 'mongoose';

import type { AppSettingDocument } from './schemas/app-setting.schema';
import { SettingsService } from './settings.service';

/**
 * Build a {@link SettingsService} backed by a settingModel stub whose
 * `find().lean().exec()` resolves to the given override rows.
 */
function settingsServiceWith(rows: Array<{ key: string; value: unknown }>): SettingsService {
  const settingModel = {
    find: jest.fn(() => ({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(rows),
    })),
  } as unknown as Model<AppSettingDocument>;
  return new SettingsService(settingModel);
}

describe('SettingsService — live operational flags', () => {
  it('returns the CODE DEFAULTS when no override rows exist', async () => {
    const service = settingsServiceWith([]);
    // Defaults: registration open, matchmaking enabled, maintenance off.
    await expect(service.isRegistrationOpen()).resolves.toBe(true);
    await expect(service.isMatchmakingEnabled()).resolves.toBe(true);
    await expect(service.isMaintenanceMode()).resolves.toBe(false);
  });

  it('honours a stored override (registration closed)', async () => {
    const service = settingsServiceWith([{ key: 'REGISTRATION_OPEN', value: false }]);
    await expect(service.isRegistrationOpen()).resolves.toBe(false);
    // Untouched flags keep their defaults.
    await expect(service.isMatchmakingEnabled()).resolves.toBe(true);
  });

  it('honours a stored override (matchmaking disabled + maintenance on)', async () => {
    const service = settingsServiceWith([
      { key: 'MATCHMAKING_ENABLED', value: false },
      { key: 'MAINTENANCE_MODE', value: true },
    ]);
    await expect(service.isMatchmakingEnabled()).resolves.toBe(false);
    await expect(service.isMaintenanceMode()).resolves.toBe(true);
  });

  it('coerces a stringy stored value ("false") to a real boolean', async () => {
    const service = settingsServiceWith([{ key: 'REGISTRATION_OPEN', value: 'false' }]);
    await expect(service.isRegistrationOpen()).resolves.toBe(false);
  });

  it('getFlag returns false for an unknown (non-live) key', async () => {
    const service = settingsServiceWith([]);
    await expect(service.getFlag('NOT_A_REAL_FLAG')).resolves.toBe(false);
  });

  it('getPublicStatus merges defaults ⊕ overrides into the public shape', async () => {
    const service = settingsServiceWith([
      { key: 'MAINTENANCE_MODE', value: true },
      { key: 'MATCHMAKING_ENABLED', value: false },
    ]);
    await expect(service.getPublicStatus()).resolves.toEqual({
      maintenanceMode: true,
      registrationOpen: true, // default (no override)
      matchmakingEnabled: false,
    });
  });

  it('falls back to defaults when the store read fails (never throws)', async () => {
    const settingModel = {
      find: jest.fn(() => ({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('mongo down')),
      })),
    } as unknown as Model<AppSettingDocument>;
    const service = new SettingsService(settingModel);

    // A read failure must not break a gate the flag guards — defaults win.
    await expect(service.isRegistrationOpen()).resolves.toBe(true);
    await expect(service.getPublicStatus()).resolves.toEqual({
      maintenanceMode: false,
      registrationOpen: true,
      matchmakingEnabled: true,
    });
  });
});
