import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import type { Rarity } from '@ruletka/shared-types';

/** Gift rarities (kept in sync with `raritySchema` in shared-types). */
const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

/**
 * A sendable virtual gift (catalogue entry). Priced in coins; some gifts are
 * gated to premium senders (`isPremiumOnly`). Seeded on boot
 * ({@link GiftsService.onModuleInit}). `code` is the stable public identifier.
 */
@Schema({ collection: 'gifts', timestamps: true })
export class Gift {
  /** Stable public identifier (e.g. `rose`). Unique — index below. */
  @Prop({ required: true, trim: true, type: String })
  code!: string;

  /** Human-readable display name. */
  @Prop({ required: true, type: String })
  title!: string;

  /** URL of the gift's (Lottie/sprite) animation asset. */
  @Prop({ required: true, type: String })
  animationUrl!: string;

  /** Cost to send, in coins. */
  @Prop({ required: true, min: 0, type: Number })
  priceCoins!: number;

  /** Visual/scarcity tier. */
  @Prop({ required: true, enum: RARITIES, default: 'common', type: String })
  rarity!: Rarity;

  /** When true, only premium senders may send this gift. */
  @Prop({ required: true, default: false })
  isPremiumOnly!: boolean;

  // `createdAt` / `updatedAt` added by `timestamps: true`.
}

export type GiftDocument = HydratedDocument<Gift>;

export const GiftSchema = SchemaFactory.createForClass(Gift);

// ── Indexes (PROJECT_SPEC §6) ──────────────────────────────────────────────
// Unique, fast lookup by public code (send flow resolves a gift per request).
GiftSchema.index({ code: 1 }, { unique: true });
