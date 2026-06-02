import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import type {
  Gift as GiftContract,
  GiftTransaction as GiftTransactionContract,
  SendGiftDto,
} from '@ruletka/shared-types';

import { BlocksService } from '../moderation/blocks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PremiumService } from '../premium/premium.service';
import { WalletService } from '../wallet/wallet.service';
import { Gift, GiftDocument } from './schemas/gift.schema';
import { GiftTransaction, GiftTransactionDocument } from './schemas/gift-transaction.schema';

/**
 * Default gift catalogue seeded on boot (idempotent upsert by `code`).
 * A spread of rarities, with the rarest gated to premium senders.
 */
const SEED_GIFTS: readonly Omit<GiftContract, 'id'>[] = [
  {
    code: 'rose',
    title: 'Rose',
    animationUrl: '/gifts/rose.json',
    priceCoins: 10,
    rarity: 'common',
    isPremiumOnly: false,
  },
  {
    code: 'heart',
    title: 'Heart',
    animationUrl: '/gifts/heart.json',
    priceCoins: 25,
    rarity: 'common',
    isPremiumOnly: false,
  },
  {
    code: 'teddy',
    title: 'Teddy Bear',
    animationUrl: '/gifts/teddy.json',
    priceCoins: 100,
    rarity: 'rare',
    isPremiumOnly: false,
  },
  {
    code: 'diamond',
    title: 'Diamond',
    animationUrl: '/gifts/diamond.json',
    priceCoins: 500,
    rarity: 'epic',
    isPremiumOnly: false,
  },
  {
    code: 'crown',
    title: 'Golden Crown',
    animationUrl: '/gifts/crown.json',
    priceCoins: 2000,
    rarity: 'legendary',
    isPremiumOnly: true,
  },
];

/**
 * Catalogue read model + the gift-send transaction flow.
 *
 * Sending a gift atomically debits the sender's wallet (via the exported
 * {@link WalletService}, ledger type `gift_out`) and records an immutable
 * {@link GiftTransaction}. Premium-only gifts are gated through
 * {@link PremiumService.isPremium}. Seeds a small default catalogue on init.
 */
@Injectable()
export class GiftsService implements OnModuleInit {
  private readonly logger = new Logger(GiftsService.name);

  constructor(
    @InjectModel(Gift.name) private readonly giftModel: Model<GiftDocument>,
    @InjectModel(GiftTransaction.name)
    private readonly giftTxModel: Model<GiftTransactionDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly walletService: WalletService,
    private readonly premiumService: PremiumService,
    private readonly blocksService: BlocksService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Idempotently seed the default catalogue (upsert by unique `code`). */
  async onModuleInit(): Promise<void> {
    await Promise.all(
      SEED_GIFTS.map((gift) =>
        this.giftModel
          .updateOne({ code: gift.code }, { $setOnInsert: gift }, { upsert: true })
          .exec(),
      ),
    );
    this.logger.log(`Seeded ${SEED_GIFTS.length} gifts (idempotent)`);
  }

  /** List the full gift catalogue (cheapest first). */
  async findAll(): Promise<GiftContract[]> {
    const docs = await this.giftModel.find().sort({ priceCoins: 1 }).exec();
    return docs.map((doc) => this.toContract(doc));
  }

  /**
   * Send a gift from `fromUserId` to `dto.toUserId`.
   *
   * Order of operations (auditable + safe):
   *  1. reject self-gifting (400);
   *  2. validate the recipient: must exist, not be banned, and not be in a
   *     block relationship with the sender in EITHER direction (so gifting can't
   *     bypass the block the chat path enforces) — all 403/404 before charging;
   *  3. resolve the gift (404 if unknown);
   *  4. enforce premium gating for `isPremiumOnly` gifts (403);
   *  5. atomically DEBIT the sender (`gift_out`) — throws 422 on low balance —
   *     using the pre-allocated gift-transaction id as the ledger `refId`;
   *  6. write the {@link GiftTransaction}. If that write fails after a
   *     successful debit, the coins are refunded (compensating `refund` credit)
   *     so we never charge without recording the gift.
   *
   * @returns the persisted gift transaction in the shared contract shape.
   */
  async sendGift(fromUserId: string, dto: SendGiftDto): Promise<GiftTransactionContract> {
    if (fromUserId === dto.toUserId) {
      throw new BadRequestException('Cannot send a gift to yourself');
    }

    // Validate the recipient BEFORE any catalogue/premium work or charging.
    await this.assertValidRecipient(fromUserId, dto.toUserId);

    const gift = await this.giftModel.findById(dto.giftId).exec();
    if (!gift) {
      throw new NotFoundException('Gift not found');
    }

    if (gift.isPremiumOnly) {
      const isPremium = await this.premiumService.isPremium(fromUserId);
      if (!isPremium) {
        throw new ForbiddenException('This gift is available to premium members only');
      }
    }

    // Pre-allocate the gift-transaction id so the wallet ledger row can
    // reference it (idempotency/traceability) before the row itself exists.
    const giftTxId = new Types.ObjectId();

    // Step 5: charge the sender first. Throws InsufficientFundsException (422)
    // without writing anything if funds are short.
    await this.walletService.debit(fromUserId, gift.priceCoins, 'gift_out', giftTxId.toString());

    // Step 6: record the gift. On failure, compensate the debit.
    try {
      const docs = await this.giftTxModel.create([
        {
          _id: giftTxId,
          fromUserId: new Types.ObjectId(fromUserId),
          toUserId: new Types.ObjectId(dto.toUserId),
          giftId: gift._id,
          priceCoins: gift.priceCoins,
          context: dto.context,
          message: dto.message ?? null,
        },
      ]);
      const created = docs[0];
      if (!created) {
        throw new Error('Gift transaction creation returned no document');
      }
      // Notify the recipient of the received gift (best-effort, post-commit).
      await this.notifyGiftReceived(fromUserId, dto.toUserId, gift.title);
      return this.toTransactionContract(created);
    } catch (err) {
      // Compensating refund so a recorded charge always has a matching gift.
      await this.walletService
        .credit(fromUserId, gift.priceCoins, 'refund', giftTxId.toString())
        .catch((refundErr: unknown) =>
          this.logger.error(
            `Failed to refund ${gift.priceCoins} coins to ${fromUserId} after ` +
              `gift-tx write failure: ${(refundErr as Error).message}`,
          ),
        );
      throw err;
    }
  }

  /**
   * Assert that `toUserId` is a valid gift recipient for `fromUserId`:
   *  - the id is a well-formed ObjectId and the account EXISTS (`404` otherwise);
   *  - the recipient is NOT banned (`403`);
   *  - there is NO block between the two in either direction (`403`), so a gift
   *    cannot reach someone the block relationship would forbid in chat.
   */
  private async assertValidRecipient(fromUserId: string, toUserId: string): Promise<void> {
    if (!Types.ObjectId.isValid(toUserId)) {
      throw new NotFoundException('Recipient not found');
    }

    const recipient = await this.connection
      .collection('users')
      .findOne({ _id: new Types.ObjectId(toUserId) }, { projection: { isBanned: 1 } });
    if (!recipient) {
      throw new NotFoundException('Recipient not found');
    }
    if ((recipient as { isBanned?: boolean }).isBanned === true) {
      throw new ForbiddenException('Cannot send a gift to this user');
    }

    if (await this.blocksService.isBlocked(fromUserId, toUserId)) {
      throw new ForbiddenException('Cannot send a gift to this user');
    }
  }

  /**
   * Raise a `gift` notification for the recipient. Best-effort and FULLY
   * self-contained: it swallows its own errors so it can never throw into the
   * gift-send `try` (which would wrongly trigger the compensating refund of an
   * already-recorded gift).
   */
  private async notifyGiftReceived(
    fromUserId: string,
    toUserId: string,
    giftTitle: string,
  ): Promise<void> {
    try {
      const nickname = await this.senderNickname(fromUserId);
      await this.notificationsService.create({
        recipientUserId: toUserId,
        kind: 'gift',
        title: 'You received a gift',
        body: `${nickname} sent you a ${giftTitle}`,
        actorId: fromUserId,
        link: `/profile/${toUserId}`,
      });
    } catch (err) {
      this.logger.debug(
        `gift notification failed (from=${fromUserId} to=${toUserId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Resolve the sender's display nickname from the `profiles` collection (read
   * by name, like the recipient existence check). Falls back to "Someone".
   */
  private async senderNickname(userId: string): Promise<string> {
    if (!Types.ObjectId.isValid(userId)) {
      return 'Someone';
    }
    const doc = await this.connection
      .collection('profiles')
      .findOne({ userId: new Types.ObjectId(userId) }, { projection: { nickname: 1 } });
    const nickname = (doc as { nickname?: string } | null)?.nickname;
    return nickname && nickname.length > 0 ? nickname : 'Someone';
  }

  /** Map a hydrated gift document to the shared `Gift` contract shape. */
  private toContract(doc: GiftDocument): GiftContract {
    return {
      id: doc._id.toString(),
      code: doc.code,
      title: doc.title,
      animationUrl: doc.animationUrl,
      priceCoins: doc.priceCoins,
      rarity: doc.rarity,
      isPremiumOnly: doc.isPremiumOnly,
    };
  }

  /** Map a hydrated gift-transaction document to the shared contract shape. */
  private toTransactionContract(doc: GiftTransactionDocument): GiftTransactionContract {
    return {
      id: doc._id.toString(),
      fromUserId: doc.fromUserId.toString(),
      toUserId: doc.toUserId.toString(),
      giftId: doc.giftId.toString(),
      priceCoins: doc.priceCoins,
      context: doc.context,
      createdAt: doc.get('createdAt').toISOString(),
    };
  }
}
