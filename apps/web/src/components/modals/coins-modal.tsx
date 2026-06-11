'use client';

/**
 * Coins modal — the primary entry point for the coin storefront.
 *
 * Thin alias over {@link BuyCoinsModal} (the long-standing implementation) so the
 * new "modal-first" wiring can reference a `CoinsModal` symbol while we keep the
 * one source of truth in `buy-coins-modal.tsx`. The legacy `'buy-coins'` modal id
 * (and all the existing call sites — gift-picker shortfall, top gates, header
 * pill "+", etc.) continue to work unchanged.
 *
 * Both entry points open the SAME body — there's no risk of drift because this
 * file only re-exports.
 *
 * Pair with the legacy `/coins` route (which redirects to `/wallet`) as the
 * SEO/bookmark fallback for users who deep-linked before the modal existed.
 */
export { BuyCoinsModal as CoinsModal } from './buy-coins-modal';
