import { test, expect } from '@playwright/test';

/**
 * Routing & navigation chrome.
 *
 * - A protected route visited without a session is bounced to /login by the
 *   edge middleware (it gates on the `ruletka_auth` marker cookie, which a fresh
 *   browser context does not have).
 * - The site header's primary navigation exposes the product's core sections.
 */
test.describe('Route protection', () => {
  test('an unauthenticated visit to /settings redirects to /login', async ({ page }) => {
    await page.goto('/settings');

    // Edge middleware redirects to /login and preserves the intended target.
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page).toHaveURL(/next=%2Fsettings/);

    // The login form is actually rendered at the destination.
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
  });
});

test.describe('Header navigation', () => {
  test('exposes the core section links', async ({ page }) => {
    await page.goto('/');

    // Two navs exist in the DOM (desktop + the collapsed mobile menu); scope to
    // the primary desktop nav by its accessible name to avoid ambiguity.
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });

    const expected: Array<[label: string, href: string]> = [
      ['Видео', '/video'],
      ['Голос', '/voice'],
      ['Друзья', '/friends'],
      ['Чаты', '/chats'],
      ['Топ', '/top'],
    ];

    for (const [label, href] of expected) {
      const link = nav.getByRole('link', { name: label, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', href);
    }
  });

  test('the brand mark links home', async ({ page }) => {
    await page.goto('/login');
    const brand = page.getByRole('link', { name: 'ruletka.top — на главную' }).first();
    await expect(brand).toBeVisible();
    await expect(brand).toHaveAttribute('href', '/');
  });
});
