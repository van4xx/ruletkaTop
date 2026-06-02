import { z } from 'zod';
import { isoDateSchema, objectIdSchema } from './common';

export const paymentProviderSchema = z.enum(['cloudpayments']);
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;

export const paymentStatusSchema = z.enum(['pending', 'completed', 'failed', 'refunded']);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const paymentPurposeSchema = z.enum(['coins', 'premium']);
export type PaymentPurpose = z.infer<typeof paymentPurposeSchema>;

export const paymentSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  provider: paymentProviderSchema,
  invoiceId: z.string(),
  amount: z.number(),
  currency: z.string().default('RUB'),
  status: paymentStatusSchema,
  purpose: paymentPurposeSchema,
  createdAt: isoDateSchema,
});
export type Payment = z.infer<typeof paymentSchema>;

/** Request body to start a coins purchase. Server returns widget params. */
export const coinsCheckoutSchema = z.object({
  packageCode: z.string(),
});
export type CoinsCheckoutDto = z.infer<typeof coinsCheckoutSchema>;

/** Params returned to the client to open the CloudPayments widget. */
export const checkoutWidgetParamsSchema = z.object({
  publicId: z.string(),
  invoiceId: z.string(),
  amount: z.number(),
  currency: z.string(),
  accountId: objectIdSchema,
  description: z.string(),
  /** Arbitrary JSON echoed back to us in webhooks via the `Data` field. */
  data: z.record(z.string(), z.unknown()),
});
export type CheckoutWidgetParams = z.infer<typeof checkoutWidgetParamsSchema>;

/**
 * CloudPayments server notification (webhook) common fields.
 *
 * CloudPayments POSTs `application/x-www-form-urlencoded` with PascalCase keys.
 * Authenticity MUST be verified via the `Content-HMAC` header (HMAC-SHA256 of
 * the raw request body using the API secret) — never trust the body alone.
 */
export const cloudPaymentsNotificationSchema = z.object({
  TransactionId: z.coerce.number().optional(),
  Amount: z.coerce.number().optional(),
  Currency: z.string().optional(),
  InvoiceId: z.string().optional(),
  AccountId: z.string().optional(),
  SubscriptionId: z.string().optional(),
  Token: z.string().optional(),
  Status: z.string().optional(),
  /** JSON string echoed from the original `data` payload. */
  Data: z.string().optional(),
});
export type CloudPaymentsNotification = z.infer<typeof cloudPaymentsNotificationSchema>;

/** Response code CloudPayments expects back from our webhook endpoints. */
export const cloudPaymentsAckSchema = z.object({
  code: z.union([z.literal(0), z.literal(11), z.literal(12), z.literal(13), z.literal(20)]),
});
export type CloudPaymentsAck = z.infer<typeof cloudPaymentsAckSchema>;
