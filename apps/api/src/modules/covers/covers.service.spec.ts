import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Model } from 'mongoose';

/**
 * A per-attempt cover ledger ref is `${userId}:${coverId}:${objectId}`: the
 * (user, cover) prefix scopes it per buyer, and the trailing 24-hex ObjectId is
 * minted fresh on every purchase attempt so a retry re-charges (a fixed ref
 * would idempotently self-cancel with its own compensating refund and grant the
 * cover for free). This matcher asserts the prefix while allowing any ObjectId.
 */
function coverRefFor(userId: string, coverId: string): RegExp {
  return new RegExp(`^${userId}:${coverId}:[0-9a-f]{24}$`);
}

import type { PublicProfile } from '@ruletka/shared-types';

import type { ProfilesService } from '../profiles/profiles.service';
import type { ProfileDocument } from '../profiles/schemas/profile.schema';
import type { WalletService } from '../wallet/wallet.service';
import { CoversService } from './covers.service';

/**
 * Builds a chainable Mongoose query stub whose terminal `.exec()` resolves to
 * `result` (mirrors the house style in gifts/wallet service specs).
 */
function queryReturning(result: unknown): { exec: jest.Mock } {
  return { exec: jest.fn().mockResolvedValue(result) };
}

/** A stand-in profile document carrying the cover inventory fields. */
function profileDoc(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    activeCover: 'aurora',
    ownedCovers: [] as string[],
    ...overrides,
  };
}

describe('CoversService', () => {
  const userId = '507f1f77bcf86cd799439011';

  let service: CoversService;
  let profileModel: { findOneAndUpdate: jest.Mock };
  let wallet: { debit: jest.Mock; credit: jest.Mock };
  let profiles: { findByUserId: jest.Mock; getPublicProfile: jest.Mock };

  beforeEach(() => {
    profileModel = { findOneAndUpdate: jest.fn() };
    wallet = {
      debit: jest.fn().mockResolvedValue(880),
      credit: jest.fn().mockResolvedValue(1000),
    };
    profiles = {
      findByUserId: jest.fn().mockResolvedValue(profileDoc()),
      getPublicProfile: jest
        .fn()
        .mockResolvedValue({ id: userId, activeCover: 'sunset' } as PublicProfile),
    };

    service = new CoversService(
      profileModel as unknown as Model<ProfileDocument>,
      wallet as unknown as WalletService,
      profiles as unknown as ProfilesService,
    );
  });

  describe('findAll', () => {
    it('returns the catalogue free-first then by ascending price', () => {
      const catalogue = service.findAll();
      expect(catalogue[0]).toMatchObject({ id: 'aurora', tier: 'free', priceCoins: 0 });
      expect(catalogue[1]).toMatchObject({ id: 'graphite', tier: 'free', priceCoins: 0 });
      // 10 covers total; the last is the flagship.
      expect(catalogue).toHaveLength(10);
      expect(catalogue.at(-1)).toMatchObject({ id: 'prismatic', tier: 'paid', priceCoins: 1500 });
      // Prices are non-decreasing across the catalogue.
      const prices = catalogue.map((c) => c.priceCoins);
      expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    });
  });

  describe('getMine', () => {
    it('returns the active cover and free ids ∪ purchased ids (free first)', async () => {
      profiles.findByUserId.mockResolvedValue(
        profileDoc({ activeCover: 'mint', ownedCovers: ['mint'] }),
      );

      const inv = await service.getMine(userId);

      expect(inv.active).toBe('mint');
      // Free ids are implicit and always present; the purchased paid id follows.
      expect(inv.owned).toEqual(['aurora', 'graphite', 'mint']);
    });

    it('defaults a profile with no activeCover to the default cover', async () => {
      profiles.findByUserId.mockResolvedValue(profileDoc({ activeCover: undefined }));

      const inv = await service.getMine(userId);

      expect(inv.active).toBe('aurora');
      expect(inv.owned).toEqual(['aurora', 'graphite']);
    });

    it('throws 404 when the profile does not exist', async () => {
      profiles.findByUserId.mockResolvedValue(null);

      await expect(service.getMine(userId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('purchase', () => {
    it('debits (cover, keyed by the user:cover pair) and grants + activates the cover', async () => {
      profileModel.findOneAndUpdate.mockReturnValue(
        queryReturning(profileDoc({ activeCover: 'sunset', ownedCovers: ['sunset'] })),
      );

      const inv = await service.purchase(userId, 'sunset');

      // Charged the catalogue price as a `cover` debit keyed by a PER-ATTEMPT ref
      // (the (user, cover) prefix + a fresh ObjectId) — NOT the bare catalogue
      // id (which is a global constant that would collide across buyers) and NOT
      // a fixed (user, cover) key (which would self-cancel on a retry).
      expect(wallet.debit).toHaveBeenCalledTimes(1);
      expect(wallet.debit).toHaveBeenCalledWith(
        userId,
        120,
        'cover',
        expect.stringMatching(coverRefFor(userId, 'sunset')),
      );

      // Granted via $addToSet AND set active in a single update.
      expect(profileModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      const [, update] = profileModel.findOneAndUpdate.mock.calls[0] as [
        unknown,
        Record<string, Record<string, unknown>>,
      ];
      expect(update.$addToSet).toEqual({ ownedCovers: 'sunset' });
      expect(update.$set).toEqual({ activeCover: 'sunset' });

      // No refund on the happy path.
      expect(wallet.credit).not.toHaveBeenCalled();

      expect(inv).toEqual({ active: 'sunset', owned: ['aurora', 'graphite', 'sunset'] });
    });

    it('charges BEFORE granting (debit precedes the profile write)', async () => {
      const order: string[] = [];
      wallet.debit.mockImplementation(async () => {
        order.push('debit');
        return 880;
      });
      profileModel.findOneAndUpdate.mockImplementation(() => {
        order.push('grant');
        return queryReturning(profileDoc({ activeCover: 'sunset', ownedCovers: ['sunset'] }));
      });

      await service.purchase(userId, 'sunset');

      expect(order).toEqual(['debit', 'grant']);
    });

    it('rejects a FREE cover (409) without charging', async () => {
      await expect(service.purchase(userId, 'graphite')).rejects.toBeInstanceOf(ConflictException);

      expect(wallet.debit).not.toHaveBeenCalled();
      expect(profileModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects an ALREADY-OWNED cover (409) without charging', async () => {
      profiles.findByUserId.mockResolvedValue(profileDoc({ ownedCovers: ['sunset', 'galaxy'] }));

      await expect(service.purchase(userId, 'galaxy')).rejects.toBeInstanceOf(ConflictException);

      expect(wallet.debit).not.toHaveBeenCalled();
      expect(profileModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('does NOT swallow an insufficient-funds debit error (nothing granted)', async () => {
      const debitErr = new Error('insufficient');
      wallet.debit.mockRejectedValue(debitErr);

      await expect(service.purchase(userId, 'noir')).rejects.toBe(debitErr);

      // Charge failed up front ⇒ no grant, nothing to refund.
      expect(profileModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(wallet.credit).not.toHaveBeenCalled();
    });

    it('compensates with a refund credit if the grant write fails after a successful debit', async () => {
      const writeErr = new Error('mongo write failed');
      profileModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockRejectedValue(writeErr),
      });

      await expect(service.purchase(userId, 'mint')).rejects.toBe(writeErr);

      // The earlier debit is reversed with a `refund` credit for the same amount,
      // keyed by the EXACT SAME per-attempt ref as the debit — so the
      // compensation pairs up to a net zero and we never charge without recording
      // ownership.
      expect(wallet.credit).toHaveBeenCalledTimes(1);
      expect(wallet.credit).toHaveBeenCalledWith(
        userId,
        200,
        'refund',
        expect.stringMatching(coverRefFor(userId, 'mint')),
      );
      const debitRef = (wallet.debit.mock.calls[0] as unknown[])[3];
      const refundRef = (wallet.credit.mock.calls[0] as unknown[])[3];
      expect(refundRef).toBe(debitRef);
    });

    it('still surfaces the original write error even if the compensating refund also fails', async () => {
      const writeErr = new Error('mongo write failed');
      profileModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockRejectedValue(writeErr),
      });
      wallet.credit.mockRejectedValue(new Error('refund failed too'));

      await expect(service.purchase(userId, 'mint')).rejects.toBe(writeErr);
      expect(wallet.credit).toHaveBeenCalledTimes(1);
    });

    it('throws 404 when the profile vanishes between the debit and the grant', async () => {
      // Guarded update matches nothing (e.g. profile deleted) → null doc.
      profileModel.findOneAndUpdate.mockReturnValue(queryReturning(null));

      await expect(service.purchase(userId, 'mint')).rejects.toBeInstanceOf(NotFoundException);

      // The debit is compensated so we don't charge for a cover we couldn't grant,
      // reusing the same per-attempt ref so the pair nets to zero.
      expect(wallet.credit).toHaveBeenCalledWith(
        userId,
        200,
        'refund',
        expect.stringMatching(coverRefFor(userId, 'mint')),
      );
      const debitRef = (wallet.debit.mock.calls[0] as unknown[])[3];
      const refundRef = (wallet.credit.mock.calls[0] as unknown[])[3];
      expect(refundRef).toBe(debitRef);
    });

    it('keys the ledger per buyer so two DIFFERENT buyers of the same cover are BOTH charged with distinct refIds (regression: paid covers were free after the first buyer)', async () => {
      const userA = '507f1f77bcf86cd799439011';
      const userB = '507f1f77bcf86cd799439abc';
      profileModel.findOneAndUpdate.mockReturnValue(
        queryReturning(profileDoc({ activeCover: 'noir', ownedCovers: ['noir'] })),
      );

      await service.purchase(userA, 'noir');
      await service.purchase(userB, 'noir');

      // Each buyer is debited under a refId scoped to THEIR userId, so neither
      // collides with the other on the global (type, refId) ledger index — the
      // second buyer is charged for real instead of silently self-refunded.
      expect(wallet.debit).toHaveBeenNthCalledWith(
        1,
        userA,
        500,
        'cover',
        expect.stringMatching(coverRefFor(userA, 'noir')),
      );
      expect(wallet.debit).toHaveBeenNthCalledWith(
        2,
        userB,
        500,
        'cover',
        expect.stringMatching(coverRefFor(userB, 'noir')),
      );
      const refA = (wallet.debit.mock.calls[0] as unknown[])[3];
      const refB = (wallet.debit.mock.calls[1] as unknown[])[3];
      expect(refA).not.toBe(refB);
    });

    it('RE-CHARGES on a retry after a compensated-refund failure (regression: a fixed ref self-cancelled and granted the cover for free)', async () => {
      // Attempt 1: the grant write fails after the debit, so the debit is
      // compensated with a matching refund (net zero) and the call throws.
      const writeErr = new Error('mongo write failed');
      profileModel.findOneAndUpdate.mockReturnValueOnce({
        exec: jest.fn().mockRejectedValue(writeErr),
      });
      // Attempt 2 (the RETRY): the grant write succeeds.
      profileModel.findOneAndUpdate.mockReturnValueOnce(
        queryReturning(profileDoc({ activeCover: 'noir', ownedCovers: ['noir'] })),
      );
      // The retry's profile is still un-owned (the failed attempt granted nothing).
      profiles.findByUserId.mockResolvedValue(profileDoc({ ownedCovers: [] }));

      await expect(service.purchase(userId, 'noir')).rejects.toBe(writeErr);
      await service.purchase(userId, 'noir');

      // Two real debits — one per attempt — under DISTINCT per-attempt refs, so
      // the retry actually re-charges instead of colliding with the first
      // attempt's ledger row and self-refunding to a free cover.
      expect(wallet.debit).toHaveBeenCalledTimes(2);
      const firstDebitRef = (wallet.debit.mock.calls[0] as unknown[])[3];
      const retryDebitRef = (wallet.debit.mock.calls[1] as unknown[])[3];
      expect(firstDebitRef).toEqual(expect.stringMatching(coverRefFor(userId, 'noir')));
      expect(retryDebitRef).toEqual(expect.stringMatching(coverRefFor(userId, 'noir')));
      expect(retryDebitRef).not.toBe(firstDebitRef);

      // Attempt 1 was compensated (its debit refunded under the same ref); the
      // successful retry issues no refund.
      expect(wallet.credit).toHaveBeenCalledTimes(1);
      expect((wallet.credit.mock.calls[0] as unknown[])[3]).toBe(firstDebitRef);
    });
  });

  describe('setActive', () => {
    it('switches to an OWNED paid cover and returns the updated public profile', async () => {
      profiles.findByUserId.mockResolvedValue(
        profileDoc({ activeCover: 'aurora', ownedCovers: ['sunset'] }),
      );
      profileModel.findOneAndUpdate.mockReturnValue(
        queryReturning(profileDoc({ activeCover: 'sunset', ownedCovers: ['sunset'] })),
      );

      const result = await service.setActive(userId, 'sunset');

      const [, update] = profileModel.findOneAndUpdate.mock.calls[0] as [
        unknown,
        Record<string, Record<string, unknown>>,
      ];
      expect(update.$set).toEqual({ activeCover: 'sunset' });
      // Returns the canonical public projection (so the client caches it like GET /profiles/:id).
      expect(profiles.getPublicProfile).toHaveBeenCalledWith(userId);
      expect(result).toMatchObject({ id: userId, activeCover: 'sunset' });
    });

    it('allows switching to a FREE cover even when never purchased', async () => {
      profiles.findByUserId.mockResolvedValue(profileDoc({ ownedCovers: [] }));
      profileModel.findOneAndUpdate.mockReturnValue(
        queryReturning(profileDoc({ activeCover: 'graphite' })),
      );

      await expect(service.setActive(userId, 'graphite')).resolves.toBeDefined();
      expect(profileModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('rejects activating a cover the caller does NOT own (403)', async () => {
      profiles.findByUserId.mockResolvedValue(profileDoc({ ownedCovers: ['sunset'] }));

      await expect(service.setActive(userId, 'galaxy')).rejects.toBeInstanceOf(ForbiddenException);

      // No write occurs when ownership is missing.
      expect(profileModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('throws 404 when the profile does not exist', async () => {
      profiles.findByUserId.mockResolvedValue(null);

      await expect(service.setActive(userId, 'aurora')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
