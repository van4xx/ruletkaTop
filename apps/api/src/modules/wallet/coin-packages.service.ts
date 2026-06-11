import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import type { CoinPackage as CoinPackageContract } from '@ruletka/shared-types';

import { CoinPackage, CoinPackageDocument } from './schemas/coin-package.schema';

/**
 * Default coin packages seeded on boot (idempotent upsert by `code`).
 *
 * Six-tile RU-market ladder. Floor is a cheap try-it tile, then a steeper
 * value curve so the top two bundles carry the biggest bonus ratios and
 * feel like the "headline" purchase. The web/coins UI surfaces the 4 000+
 * tiles as "Хит" / "Лучшая цена" using `priceRub >= 2499` as the boundary
 * (no extra contract field — the existing `CoinPackage` shape stays intact).
 *
 * Re-pricing migration: this seeder runs `$set` (not just `$setOnInsert`)
 * on every boot, so deployments with the previous catalogue automatically
 * adopt the new prices/coin totals on the next restart — no manual
 * drop-and-reseed needed. Retired ladder codes are deleted in the same pass.
 */
const SEED_PACKAGES: readonly CoinPackageContract[] = [
  { code: 'coins_100', coins: 100, priceRub: 99, bonusCoins: 0 },
  { code: 'coins_300', coins: 300, priceRub: 249, bonusCoins: 0 },
  { code: 'coins_700', coins: 700, priceRub: 499, bonusCoins: 50 },
  { code: 'coins_1500', coins: 1500, priceRub: 999, bonusCoins: 200 },
  { code: 'coins_4000', coins: 4000, priceRub: 2499, bonusCoins: 600 },
  { code: 'coins_10000', coins: 10000, priceRub: 4999, bonusCoins: 2000 },
];

/**
 * Legacy package codes superseded 1:1 by the new ladder above. Listed
 * explicitly so a redeploy doesn't leave stale tiles in the picker, but
 * doesn't touch any other catalogue rows admins may have created out of band.
 */
const RETIRED_PACKAGE_CODES: readonly string[] = [
  'coins_550',
  'coins_1200',
  'coins_2600',
  'coins_7000',
];

/**
 * Read model + catalogue manager for purchasable {@link CoinPackage}s.
 *
 * EXPORTED from {@link WalletModule}. The payments domain resolves a package by
 * `code` at checkout via {@link findByCode}; this service structurally
 * implements the payments-side `CoinPackagesServiceContract`. Seeds a small
 * default catalogue on module init so a fresh database is immediately usable.
 */
@Injectable()
export class CoinPackagesService implements OnModuleInit {
  private readonly logger = new Logger(CoinPackagesService.name);

  constructor(
    @InjectModel(CoinPackage.name)
    private readonly packageModel: Model<CoinPackageDocument>,
  ) {}

  /**
   * Idempotently seed the default catalogue (upsert by unique `code`).
   *
   * The update uses `$set` so the seed doubles as a self-applying re-pricing
   * migration: existing rows have their `coins / priceRub / bonusCoins` brought
   * up to the current ladder on every boot. `code` is the stable public
   * identifier so we only pin it on insert. Retired ladder codes are deleted
   * in the same pass so a redeploy never leaves stale tiles in the picker.
   */
  async onModuleInit(): Promise<void> {
    await Promise.all(
      SEED_PACKAGES.map((pkg) =>
        this.packageModel
          .updateOne(
            { code: pkg.code },
            {
              $set: {
                coins: pkg.coins,
                priceRub: pkg.priceRub,
                bonusCoins: pkg.bonusCoins,
              },
              $setOnInsert: { code: pkg.code },
            },
            { upsert: true },
          )
          .exec(),
      ),
    );
    if (RETIRED_PACKAGE_CODES.length > 0) {
      await this.packageModel.deleteMany({ code: { $in: [...RETIRED_PACKAGE_CODES] } }).exec();
    }
    this.logger.log(
      `Seeded ${SEED_PACKAGES.length} coin packages (idempotent; retired ${RETIRED_PACKAGE_CODES.length})`,
    );
  }

  /** List the full catalogue (cheapest first) as the shared contract shape. */
  async findAll(): Promise<CoinPackageContract[]> {
    const docs = await this.packageModel.find().sort({ priceRub: 1 }).lean().exec();
    return docs.map((doc) => this.toContract(doc));
  }

  /** Resolve a package by its public `code`, or `null` when unknown. */
  async findByCode(code: string): Promise<CoinPackageContract | null> {
    const doc = await this.packageModel.findOne({ code }).lean().exec();
    return doc ? this.toContract(doc) : null;
  }

  /** Project a (lean) package document to the shared contract shape. */
  private toContract(
    doc: Pick<CoinPackage, 'code' | 'coins' | 'priceRub' | 'bonusCoins'>,
  ): CoinPackageContract {
    return {
      code: doc.code,
      coins: doc.coins,
      priceRub: doc.priceRub,
      bonusCoins: doc.bonusCoins,
    };
  }
}
