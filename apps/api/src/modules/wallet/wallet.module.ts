import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CoinPackagesService } from './coin-packages.service';
import { CoinPackage, CoinPackageSchema } from './schemas/coin-package.schema';
import { CoinTransaction, CoinTransactionSchema } from './schemas/coin-transaction.schema';
import { Wallet, WalletSchema } from './schemas/wallet.schema';
import { CoinPackagesController, WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

/**
 * The MONEY core: owns the `wallets`, `cointransactions` and `coinpackages`
 * collections and the atomic balance API.
 *
 * Exports {@link WalletService} (atomic `credit`/`debit`/`getBalance`,
 * `ensureWallet`) and {@link CoinPackagesService} (`findByCode`/`findAll`).
 * These are consumed by `gifts`, `top` and `payments`; the integrator binds
 * them to the payments-side DI tokens (`WALLET_SERVICE`,
 * `COIN_PACKAGES_SERVICE`) via `useExisting`.
 *
 * Exposes `GET /coin-packages` (public) and `GET /wallet`,
 * `GET /wallet/transactions` (authenticated).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Wallet.name, schema: WalletSchema },
      { name: CoinTransaction.name, schema: CoinTransactionSchema },
      { name: CoinPackage.name, schema: CoinPackageSchema },
    ]),
  ],
  controllers: [WalletController, CoinPackagesController],
  providers: [WalletService, CoinPackagesService],
  exports: [WalletService, CoinPackagesService, MongooseModule],
})
export class WalletModule {}
