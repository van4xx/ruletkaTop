import type { CoinPackage } from '@ruletka/shared-types';

/**
 * Cross-module service contracts consumed by the payments domain.
 *
 * The economy module owns the real `WalletService`, `PremiumService` and
 * `CoinPackagesService`. To keep `payments` independently compilable in the
 * parallel monorepo build (no source dependency on another agent's files), we
 * depend on these structural interfaces via injection TOKENS rather than on the
 * concrete classes. The integrator binds the concrete providers to the tokens
 * below (e.g. `{ provide: WALLET_SERVICE, useExisting: WalletService }`), which
 * resolves any module ordering / forwardRef concerns in one place.
 *
 * The signatures here MUST stay structurally compatible with the economy
 * services described in the inter-module service contract.
 */

/** Atomic wallet operations. Implemented by economy `WalletService`. */
export interface WalletServiceContract {
  /** Current coin balance for a user. */
  getBalance(userId: string): Promise<number>;
  /**
   * Atomically credit coins and append a ledger row. Returns the new balance.
   * `type` is a `CoinTxType`; `refId` is the idempotency/reference key
   * (we pass the payment `invoiceId`).
   */
  credit(userId: string, coins: number, type: string, refId: string): Promise<number>;
  /**
   * Atomically debit coins (guarded by balance ≥ coins) and append a ledger
   * row. Returns the new balance. Throws on insufficient funds.
   */
  debit(userId: string, coins: number, type: string, refId: string): Promise<number>;
}

/** Premium/subscription lifecycle. Implemented by economy `PremiumService`. */
export interface PremiumServiceContract {
  isPremium(userId: string): Promise<boolean>;
  /**
   * Activate (or extend) premium for a user.
   * @param plan plan code (e.g. `monthly`).
   * @param currentPeriodEnd end of the paid period.
   * @param token optional CloudPayments recurring-charge token to persist for
   *        subscription renewals.
   */
  activate(
    userId: string,
    plan: string,
    currentPeriodEnd: Date,
    token?: string,
  ): Promise<void>;
  /** Cancel premium (e.g. on a Recurrent `Cancelled` notification or refund). */
  cancel(userId: string): Promise<void>;
}

/** Coin package catalogue. Implemented by economy `CoinPackagesService`. */
export interface CoinPackagesServiceContract {
  /** Resolve a coin package by its public code, or `null` when unknown. */
  findByCode(code: string): Promise<CoinPackage | null>;
}

/** DI token for {@link WalletServiceContract}. */
export const WALLET_SERVICE = Symbol('WALLET_SERVICE');
/** DI token for {@link PremiumServiceContract}. */
export const PREMIUM_SERVICE = Symbol('PREMIUM_SERVICE');
/** DI token for {@link CoinPackagesServiceContract}. */
export const COIN_PACKAGES_SERVICE = Symbol('COIN_PACKAGES_SERVICE');
