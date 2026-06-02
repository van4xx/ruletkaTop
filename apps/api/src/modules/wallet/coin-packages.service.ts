import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import type { CoinPackage as CoinPackageContract } from '@ruletka/shared-types';

import { CoinPackage, CoinPackageDocument } from './schemas/coin-package.schema';

/**
 * Default coin packages seeded on boot (idempotent upsert by `code`).
 * Roughly increasing value-for-money: bigger bundles carry larger bonuses.
 */
const SEED_PACKAGES: readonly CoinPackageContract[] = [
  { code: 'coins_100', coins: 100, priceRub: 99, bonusCoins: 0 },
  { code: 'coins_550', coins: 500, priceRub: 449, bonusCoins: 50 },
  { code: 'coins_1200', coins: 1000, priceRub: 849, bonusCoins: 200 },
  { code: 'coins_2600', coins: 2000, priceRub: 1599, bonusCoins: 600 },
  { code: 'coins_7000', coins: 5000, priceRub: 3499, bonusCoins: 2000 },
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

  /** Idempotently seed the default catalogue (upsert by unique `code`). */
  async onModuleInit(): Promise<void> {
    await Promise.all(
      SEED_PACKAGES.map((pkg) =>
        this.packageModel
          .updateOne(
            { code: pkg.code },
            {
              $setOnInsert: {
                code: pkg.code,
                coins: pkg.coins,
                priceRub: pkg.priceRub,
                bonusCoins: pkg.bonusCoins,
              },
            },
            { upsert: true },
          )
          .exec(),
      ),
    );
    this.logger.log(`Seeded ${SEED_PACKAGES.length} coin packages (idempotent)`);
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
  private toContract(doc: Pick<CoinPackage, 'code' | 'coins' | 'priceRub' | 'bonusCoins'>): CoinPackageContract {
    return {
      code: doc.code,
      coins: doc.coins,
      priceRub: doc.priceRub,
      bonusCoins: doc.bonusCoins,
    };
  }
}
