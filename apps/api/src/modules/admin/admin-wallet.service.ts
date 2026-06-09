import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, type QueryFilter, Types } from 'mongoose';

import type {
  AdminLedgerEntry,
  AdminWalletAdjustResult,
  AdminWalletDetail,
  AdminWalletStats,
} from '@ruletka/shared-types';

import { CoinTransactionDocument } from '../wallet/schemas/coin-transaction.schema';
import { WalletService } from '../wallet/wallet.service';

/** How many ledger rows the wallet detail surfaces per page. */
const LEDGER_PAGE = 25;

/**
 * Admin wallet surface. REAL — wires to the exported {@link WalletService} for
 * the authoritative balance + atomic credit/debit, and reads the
 * `cointransactions` ledger directly for the paginated history.
 *
 * A manual adjustment routes through the same guarded `credit`/`debit` as the
 * rest of the economy (ledger type `bonus` for a credit, `refund` for a debit),
 * so an admin top-up/clawback is fully audited in the coin ledger AND (via the
 * controller) in the admin audit log.
 */
@Injectable()
export class AdminWalletService {
  constructor(
    private readonly walletService: WalletService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * A user's balance + a page of their ledger (newest first). `404` on an
   * invalid id. Keyset-paginated on `_id` (time-ordered).
   */
  async getDetail(userId: string, cursor?: string): Promise<AdminWalletDetail> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }
    const balanceCoins = await this.walletService.getBalance(userId);

    const filter: QueryFilter<CoinTransactionDocument> = {
      userId: new Types.ObjectId(userId),
    };
    if (cursor && Types.ObjectId.isValid(cursor)) {
      filter._id = { $lt: new Types.ObjectId(cursor) };
    }

    const rows = await this.walletService.ledgerModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(LEDGER_PAGE + 1)
      .exec();

    const hasMore = rows.length > LEDGER_PAGE;
    const page = hasMore ? rows.slice(0, LEDGER_PAGE) : rows;
    const last = page.at(-1);

    return {
      userId,
      balanceCoins,
      ledger: page.map((doc) => this.toLedgerEntry(doc)),
      nextCursor: hasMore && last ? last._id.toString() : null,
      hasMore,
    };
  }

  /**
   * Apply a signed manual adjustment: a positive `amount` credits (`bonus`), a
   * negative one debits (`refund`). Debits are guarded by the wallet's
   * balance-≥-amount invariant (throws `422` on shortfall). Returns the new
   * balance + the applied delta. `reason` is recorded by the controller in the
   * audit log.
   */
  async adjust(userId: string, amount: number, _reason: string): Promise<AdminWalletAdjustResult> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }
    if (!Number.isInteger(amount) || amount === 0) {
      throw new BadRequestException('Amount must be a non-zero integer');
    }

    // The coin ledger's idempotency index is GLOBAL on `(type, refId)`, so the
    // refId MUST uniquely identify THIS adjustment. A constant `'admin-adjust'`
    // collided across every adjustment of the same sign: the first credit (or
    // debit) wrote the lone `('bonus','admin-adjust')` (or `('refund',…)`) row,
    // and every later same-sign adjustment hit that existing row, was treated as
    // "already applied", self-compensated its speculative `$inc`, and silently
    // no-op'd the balance (a false 200 + audit-success). Mint a globally-unique
    // refId per adjustment (mirrors CoversService keying the ledger per-op) so
    // each adjustment is its own ledger row and always moves the balance.
    const ref = `admin-adjust:${userId}:${new Types.ObjectId().toString()}`;

    const balanceCoins =
      amount > 0
        ? await this.walletService.credit(userId, amount, 'bonus', ref)
        : await this.walletService.debit(userId, -amount, 'refund', ref);

    return { userId, balanceCoins, delta: amount };
  }

  /** Economy-wide wallet aggregates (circulation, count, mean, max). */
  async getStats(): Promise<AdminWalletStats> {
    const wallets = this.connection.collection('wallets');
    const rows = await wallets
      .aggregate<{
        total: number;
        count: number;
        top: number;
      }>([
        {
          $group: {
            _id: null,
            total: { $sum: '$balanceCoins' },
            count: { $sum: 1 },
            top: { $max: '$balanceCoins' },
          },
        },
      ])
      .toArray();

    const agg = rows[0];
    const coinsInCirculation = agg?.total ?? 0;
    const walletCount = agg?.count ?? 0;
    return {
      coinsInCirculation,
      walletCount,
      averageBalance: walletCount > 0 ? coinsInCirculation / walletCount : 0,
      topBalance: agg?.top ?? 0,
    };
  }

  /** Map a hydrated ledger document to the admin ledger-entry shape. */
  private toLedgerEntry(doc: CoinTransactionDocument): AdminLedgerEntry {
    return {
      id: doc._id.toString(),
      delta: doc.delta,
      type: doc.type,
      refId: doc.refId ?? null,
      balanceAfter: doc.balanceAfter,
      createdAt: (doc.get('createdAt') as Date).toISOString(),
    };
  }
}
