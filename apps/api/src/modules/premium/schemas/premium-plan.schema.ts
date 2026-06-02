import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * A premium subscription plan (catalogue entry). `intervalDays` is the billing
 * period length used to compute `currentPeriodEnd` on activation/renewal.
 * Seeded on boot ({@link PremiumService.onModuleInit}); `code` is the stable
 * public identifier referenced by `Subscription.plan` and the subscribe flow.
 */
@Schema({ collection: 'premiumplans', timestamps: true })
export class PremiumPlan {
  /** Stable public identifier (e.g. `monthly`). Unique — index below. */
  @Prop({ required: true, trim: true, type: String })
  code!: string;

  /** Human-readable display name. */
  @Prop({ required: true, type: String })
  title!: string;

  /** Price in whole Russian rubles per billing period. */
  @Prop({ required: true, min: 1, type: Number })
  priceRub!: number;

  /** Billing period length in days (also the access window granted). */
  @Prop({ required: true, min: 1, type: Number })
  intervalDays!: number;

  /** Marketing perks shown on the plan card. */
  @Prop({ required: true, type: [String], default: [] })
  perks!: string[];

  // `createdAt` / `updatedAt` added by `timestamps: true`.
}

export type PremiumPlanDocument = HydratedDocument<PremiumPlan>;

export const PremiumPlanSchema = SchemaFactory.createForClass(PremiumPlan);

// ── Indexes (PROJECT_SPEC §6) ──────────────────────────────────────────────
// Unique, fast lookup by public code (subscribe flow resolves a plan).
PremiumPlanSchema.index({ code: 1 }, { unique: true });
