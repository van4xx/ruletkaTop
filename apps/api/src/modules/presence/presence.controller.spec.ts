import type { JwtPayload } from '@ruletka/shared-types';

import type { SettingsService } from '../settings/settings.service';
import { PresenceController } from './presence.controller';
import type { PresenceService } from './presence.service';

/**
 * The REST presence lookup must honour `showOnlineStatus`: a user who hides it
 * reads as offline to everyone but themselves.
 */
describe('PresenceController.getStatus — showOnlineStatus masking', () => {
  const viewer = '507f1f77bcf86cd799439011';
  const target = '507f1f77bcf86cd799439012';

  let controller: PresenceController;
  let presence: { getStatus: jest.Mock };
  let settings: { getShowOnlineStatus: jest.Mock };

  const user = (sub: string): JwtPayload => ({ sub }) as JwtPayload;

  beforeEach(() => {
    presence = { getStatus: jest.fn().mockResolvedValue('online') };
    settings = { getShowOnlineStatus: jest.fn().mockResolvedValue(true) };
    controller = new PresenceController(
      presence as unknown as PresenceService,
      settings as unknown as SettingsService,
    );
  });

  it('returns the real status when the target exposes their presence', async () => {
    const res = await controller.getStatus(user(viewer), target);
    expect(res).toEqual({ userId: target, status: 'online' });
  });

  it('masks the status to offline when the target hides their presence', async () => {
    settings.getShowOnlineStatus.mockResolvedValue(false);
    const res = await controller.getStatus(user(viewer), target);
    expect(res).toEqual({ userId: target, status: 'offline' });
  });

  it('always shows the owner their OWN true status, even when hidden', async () => {
    settings.getShowOnlineStatus.mockResolvedValue(false);
    const res = await controller.getStatus(user(target), target);
    expect(res).toEqual({ userId: target, status: 'online' });
    // Owner self-view never even consults the privacy flag.
    expect(settings.getShowOnlineStatus).not.toHaveBeenCalled();
  });
});
