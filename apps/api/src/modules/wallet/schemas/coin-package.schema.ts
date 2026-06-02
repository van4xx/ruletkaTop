import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * A purchasable bundle of coins (catalogue entry). Referenced by `code` from
 * the payments flow (CloudPayments checkout) — the `priceRub` here is the
 * authoritative amount charged, and `coins + bonusCoins` is what we credit on a
 * successful payment.
 *
 * Seeded at startup ({@link CoinPackagesService.onModuleInit}); admins may later
 * manage these out of band. `code` is the stable public identifier.
 */
@Schema({ collection: 'coinpackages', timestamps: true })
export class CoinPackage {
  /** Stable public identifier (e.g. `coins_100`). Unique — index below. */
  @Prop({ required: true, trim: true, type: String })
  code!: string;

  /** Base coins granted by the package. */
  @Prop({ required: true, min: 1, type: Number })
  coins!: number;

  /** Price in whole Russian rubles. */
  @Prop({ required: true, min: 1, type: Number })
  priceRub!: number;

  /** Promotional bonus coins on top of `coins`. */
  @Prop({ required: true, default: 0, min: 0, type: Number })
  bonusCoins!: number;

  // `createdAt` / `updatedAt` added by `timestamps: true`.
}

export type CoinPackageDocument = HydratedDocument<CoinPackage>;

export const CoinPackageSchema = SchemaFactory.createForClass(CoinPackage);

// ── Indexes (PROJECT_SPEC §6) ──────────────────────────────────────────────
// Unique, fast lookup by public code (payments resolves a package per checkout).
CoinPackageSchema.index({ code: 1 }, { unique: true });
