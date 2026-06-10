import { z } from 'zod';
import { isoDateSchema, objectIdSchema } from './common';

/**
 * Active payment providers. T-Bank (Tinkoff) e-acquiring is the default; the
 * legacy CloudPayments adapter is kept so we can fall back via the
 * `PAYMENT_PROVIDER` env without a code change.
 */
export const paymentProviderSchema = z.enum(['cloudpayments', 'tbank']);
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

/**
 * Hosted-redirect checkout result returned by the API to the web client for
 * T-Bank flows. The client `window.location.href = paymentUrl` and the user
 * lands back on success/fail URL afterwards; entitlement is granted by the
 * webhook. `orderId` lets the client recognise its own checkout if needed.
 *
 * Additive: CloudPayments flows still use {@link checkoutWidgetParamsSchema}.
 */
export const hostedCheckoutResultSchema = z.object({
  provider: paymentProviderSchema,
  paymentUrl: z.string().url(),
  orderId: z.string(),
});
export type HostedCheckoutResult = z.infer<typeof hostedCheckoutResultSchema>;

/**
 * T-Bank (Tinkoff) e-acquiring webhook envelope.
 *
 * Authoritative status enum: NEW | AUTHORIZED | CONFIRMED | REVERSED |
 * REFUNDED | PARTIAL_REFUNDED | REJECTED. Authenticity is verified via the
 * `Token` field (SHA-256 of the sorted-by-key value concatenation including
 * the merchant Password) — see `signTbankToken`.
 */
export const tbankStatusSchema = z.enum([
  'NEW',
  'AUTHORIZED',
  'CONFIRMED',
  'REVERSED',
  'REFUNDED',
  'PARTIAL_REFUNDED',
  'REJECTED',
]);
export type TbankStatus = z.infer<typeof tbankStatusSchema>;

export const tbankNotificationSchema = z.object({
  TerminalKey: z.string(),
  OrderId: z.string(),
  Success: z.coerce.boolean(),
  Status: tbankStatusSchema,
  PaymentId: z.union([z.string(), z.number()]).transform((v) => String(v)),
  ErrorCode: z.string().optional(),
  Amount: z.coerce.number().optional(),
  CardId: z.union([z.string(), z.number()]).optional(),
  Pan: z.string().optional(),
  ExpDate: z.string().optional(),
  RebillId: z.union([z.string(), z.number()]).optional().transform((v) => (v === undefined ? undefined : String(v))),
  Token: z.string(),
  Data: z.record(z.string(), z.string()).optional(),
  Receipt: z.unknown().optional(),
});
export type TbankNotification = z.infer<typeof tbankNotificationSchema>;
