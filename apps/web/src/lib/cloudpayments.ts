/**
 * Typed loader + thin wrapper around the CloudPayments payment widget.
 *
 * Card data NEVER touches our servers: the widget is a hosted iframe that
 * tokenises the card directly with CloudPayments. We only hand it the
 * server-minted params (publicId, invoiceId, amount, …) and react to the
 * success/fail/complete callbacks.
 *
 * The widget bundle is loaded on demand (first `openCloudPaymentsWidget` call)
 * from the official CDN and cached on `window`, so it is never shipped in the
 * initial bundle. Consumers may instead preload it declaratively with
 * `<Script src={CLOUDPAYMENTS_WIDGET_SRC} strategy="lazyOnload" />`.
 *
 * Docs: https://developers.cloudpayments.ru/#widget
 */

/** Official CloudPayments widget bundle (loaded lazily, never bundled). */
export const CLOUDPAYMENTS_WIDGET_SRC = 'https://widget.cloudpayments.ru/bundles/cloudpayments.js';

/** Recurrent (subscription) descriptor placed under `data.cloudPayments.recurrent`. */
export interface CloudPaymentsRecurrent {
  /** Billing cadence unit. */
  interval: 'Day' | 'Week' | 'Month';
  /** Number of `interval`s between charges (e.g. `interval:'Month', period:1`). */
  period: number;
  /** Optional cap on the number of charges. */
  maxPeriods?: number;
  /** Optional amount for subsequent charges if different from the first. */
  amount?: number;
  /** Optional ISO-8601 start date for the first recurring charge. */
  startDate?: string;
}

/** Arbitrary JSON echoed back to our webhooks via the `Data` field. */
export type CloudPaymentsData = Record<string, unknown> & {
  cloudPayments?: {
    recurrent?: CloudPaymentsRecurrent;
  };
};

/** Options accepted by the widget's `pay`/`charge` methods. */
export interface CloudPaymentsOptions {
  /** Site identifier from the CloudPayments back office. */
  publicId: string;
  /** Human-readable purpose shown on the widget + receipts. */
  description: string;
  /** Charge amount (major units, e.g. roubles). */
  amount: number;
  /** ISO-4217 currency code (RUB/USD/EUR/GBP). */
  currency: string;
  /** Payer id — REQUIRED to create a subscription. */
  accountId?: string;
  /** Our order/invoice id used to reconcile the webhook. */
  invoiceId?: string;
  /** Pre-fill the payer email. */
  email?: string;
  /** Force email collection. */
  requireEmail?: boolean;
  /** Widget skin. */
  skin?: 'classic' | 'modern' | 'mini';
  /** Custom data (incl. the `cloudPayments.recurrent` subscription block). */
  data?: CloudPaymentsData;
}

/** Callbacks fired by the widget through its lifecycle. */
export interface CloudPaymentsCallbacks {
  /** Card was charged successfully (money capture confirmed by the gateway). */
  onSuccess?: (options: CloudPaymentsOptions) => void;
  /** Payment failed / was declined. */
  onFail?: (reason: string, options: CloudPaymentsOptions) => void;
  /** Always fired after the gateway responds (cannot redirect). */
  onComplete?: (
    result: { success: boolean; message?: string },
    options: CloudPaymentsOptions,
  ) => void;
}

interface CloudPaymentsInstance {
  pay: (
    scheme: 'charge' | 'auth',
    options: CloudPaymentsOptions,
    callbacks?: CloudPaymentsCallbacks,
  ) => void;
}

interface CloudPaymentsConstructor {
  new (config?: { language?: string }): CloudPaymentsInstance;
}

declare global {
  interface Window {
    cp?: { CloudPayments: CloudPaymentsConstructor };
  }
}

let loaderPromise: Promise<CloudPaymentsConstructor> | null = null;

/**
 * Lazily injects the CloudPayments widget bundle and resolves with the
 * `CloudPayments` constructor. Idempotent: concurrent calls share one load.
 */
export function loadCloudPayments(): Promise<CloudPaymentsConstructor> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('CloudPayments can only load in the browser'));
  }
  if (window.cp?.CloudPayments) {
    return Promise.resolve(window.cp.CloudPayments);
  }
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<CloudPaymentsConstructor>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${CLOUDPAYMENTS_WIDGET_SRC}"]`,
    );

    const onLoad = () => {
      if (window.cp?.CloudPayments) {
        resolve(window.cp.CloudPayments);
      } else {
        loaderPromise = null;
        reject(new Error('CloudPayments bundle loaded but the global was not found'));
      }
    };
    const onError = () => {
      loaderPromise = null;
      reject(new Error('Failed to load the CloudPayments widget'));
    };

    if (existing) {
      existing.addEventListener('load', onLoad, { once: true });
      existing.addEventListener('error', onError, { once: true });
      // Script tag may already be loaded (e.g. via next/script).
      if (window.cp?.CloudPayments) onLoad();
      return;
    }

    const script = document.createElement('script');
    script.src = CLOUDPAYMENTS_WIDGET_SRC;
    script.async = true;
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    document.head.appendChild(script);
  });

  return loaderPromise;
}

/**
 * Opens the CloudPayments widget for a single `charge` (works for both one-off
 * coin top-ups and the first charge of a recurrent subscription when
 * `options.data.cloudPayments.recurrent` is set).
 *
 * Resolves on `onComplete`; rejects if the bundle fails to load. The
 * success/failure of the charge itself is reported through `callbacks`.
 */
export async function openCloudPaymentsWidget(
  options: CloudPaymentsOptions,
  callbacks: CloudPaymentsCallbacks = {},
  config?: { language?: string },
): Promise<void> {
  const CloudPayments = await loadCloudPayments();
  const widget = new CloudPayments(config ?? { language: 'ru-RU' });
  widget.pay('charge', options, callbacks);
}
