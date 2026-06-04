/**
 * `/coins` — retired.
 *
 * The coin storefront now lives in the unified «Купить монеты» modal
 * (`components/modals/buy-coins-modal.tsx`), opened from the balance "+",
 * the dashboard widgets, the gift/Top gates, etc. The standalone page is gone.
 *
 * We keep this route as a permanent redirect to `/wallet` (the account view,
 * which itself surfaces a top-up flow) so old bookmarks / deep links don't 404.
 */
import { redirect } from 'next/navigation';

export default function CoinsPage() {
  redirect('/wallet');
}
