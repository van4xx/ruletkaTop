import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Types } from 'mongoose';

import {
  type CoinPackage,
  type CoinTransaction,
  type JwtPayload,
  type PaginationQuery,
  paginationQuerySchema,
  type Wallet,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { CoinPackagesService } from './coin-packages.service';
import { WalletService } from './wallet.service';

/** Paginated ledger response envelope (rows + cursor meta). */
interface CoinTransactionPage {
  items: CoinTransaction[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Public catalogue of purchasable coin packages under `/coin-packages`.
 * Unauthenticated by design — the storefront shows pricing before login.
 */
@ApiTags('wallet')
@Controller('coin-packages')
export class CoinPackagesController {
  constructor(private readonly coinPackagesService: CoinPackagesService) {}

  @Get()
  @ApiOperation({ summary: 'List purchasable coin packages (cheapest first)' })
  @ApiOkResponse({ description: 'Coin package catalogue' })
  async list(): Promise<CoinPackage[]> {
    return this.coinPackagesService.findAll();
  }
}

/**
 * Authenticated wallet surface under `/wallet`: the caller's balance and a
 * cursor-paginated view of their coin ledger. Both routes operate exclusively
 * on `@CurrentUser()`'s wallet.
 */
@ApiTags('wallet')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @ApiOperation({ summary: "Fetch the authenticated user's coin balance" })
  @ApiOkResponse({ description: 'Wallet (lazily created at zero on first read)' })
  async getWallet(@CurrentUser() user: JwtPayload): Promise<Wallet> {
    const balanceCoins = await this.walletService.getBalance(user.sub);
    return { userId: user.sub, balanceCoins };
  }

  @Get('transactions')
  @ApiOperation({ summary: "List the authenticated user's coin ledger (newest first)" })
  @ApiQuery({ name: 'cursor', required: false, description: 'Opaque id cursor' })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (1–100, default 20)' })
  @ApiOkResponse({ description: 'Paginated coin transactions' })
  async getTransactions(
    @CurrentUser() user: JwtPayload,
    @Query(createZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ): Promise<CoinTransactionPage> {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(user.sub) };
    // Cursor is the last-seen ledger `_id`; descending `_id` ≈ descending time.
    if (query.cursor && Types.ObjectId.isValid(query.cursor)) {
      filter._id = { $lt: new Types.ObjectId(query.cursor) };
    }

    // Fetch one extra row to determine `hasMore` without a count query.
    const docs = await this.walletService.ledgerModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(query.limit + 1)
      .exec();

    const hasMore = docs.length > query.limit;
    const page = hasMore ? docs.slice(0, query.limit) : docs;
    const items = page.map((doc) => this.walletService.toCoinTransaction(doc));
    const last = page.at(-1);

    return {
      items,
      nextCursor: hasMore && last ? last._id.toString() : null,
      hasMore,
    };
  }
}
