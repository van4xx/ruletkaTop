import { test, expect } from '@playwright/test';

/**
 * Landing page (`/`).
 *
 * Verifies the page renders, is branded, exposes the primary «Начать» CTA that
 * points at the video roulette, and shows the signature two-direction "Top"
 * marquee teaser. Selectors lean on roles/text so they survive markup tweaks.
 */
test.describe('Landing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders and is branded in the document title', async ({ page }) => {
    // A real document arrived (not an error/blank shell).
    await expect(page).toHaveTitle(/ruletka/i);

    // The hero headline is present.
    await expect(
      page.getByRole('heading', { level: 1, name: /Встреться с миром/i }),
    ).toBeVisible();
  });

  test('the «Начать» CTA is visible and links to /video', async ({ page }) => {
    // The hero primary CTA is a link (not the in-call control button). Scope to
    // links with the accessible name "Начать" and assert at least one targets
    // the video roulette.
    const startCta = page.getByRole('link', { name: 'Начать', exact: true });
    await expect(startCta.first()).toBeVisible();
    await expect(startCta.first()).toHaveAttribute('href', '/video');

    // Following it actually lands on the roulette route.
    await startCta.first().click();
    await expect(page).toHaveURL(/\/video$/);
  });

  test('shows the two-direction Top marquee teaser', async ({ page }) => {
    // The teaser panel is labelled and links to the full Top feed.
    await expect(page.getByText('Топ эфира')).toBeVisible();
    await expect(page.getByRole('link', { name: /Смотреть весь Топ/i })).toHaveAttribute(
      'href',
      '/top',
    );

    // The marquee itself renders both opposing lanes. The lanes animate via the
    // `marquee-up` / `marquee-down` keyframes (inline style), so assert that
    // both directions are mounted — that is what makes it "two-direction".
    const upLane = page.locator('[style*="marquee-up"]');
    const downLane = page.locator('[style*="marquee-down"]');
    await expect(upLane.first()).toBeAttached();
    await expect(downLane.first()).toBeAttached();
  });
});
