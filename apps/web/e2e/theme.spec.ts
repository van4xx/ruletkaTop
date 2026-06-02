import { test, expect, type Page } from '@playwright/test';

/**
 * Theme toggle.
 *
 * The toggle (next-themes, `attribute="class"`) cycles system → light → dark and
 * reflects the active scheme by toggling the `dark` class on <html>. We force a
 * known OS preference (light) so the `system` step resolves deterministically to
 * "no dark class". The starting theme is `system`, so rather than assume a fixed
 * position in the cycle we drive it: click until the `dark` class turns ON, then
 * click until it turns OFF — proving the switch flips the documentElement class
 * in both directions, independent of the initial state.
 */

// Pin the emulated OS color scheme so the `system` step is unambiguous.
test.use({ colorScheme: 'light' });

const hasDarkClass = (page: Page) =>
  page.evaluate(() => document.documentElement.classList.contains('dark'));

/**
 * Click the toggle until `hasDarkClass` equals `target`, up to the number of
 * states in the cycle. Returns once the class settles or throws on timeout.
 */
async function clickUntilDark(page: Page, toggle: ReturnType<Page['getByRole']>, target: boolean) {
  // The cycle has 3 states (system/light/dark); a target is always reachable
  // within that many clicks from any starting point.
  for (let i = 0; i < 3; i += 1) {
    if ((await hasDarkClass(page)) === target) return;
    await toggle.click();
    // Let next-themes commit the class mutation before re-checking.
    await expect.poll(() => hasDarkClass(page), { timeout: 2_000 }).toBeDefined();
    if ((await hasDarkClass(page)) === target) return;
  }
  await expect.poll(() => hasDarkClass(page)).toBe(target);
}

test.describe('Theme toggle', () => {
  test('cycling the theme switch flips the <html> "dark" class', async ({ page }) => {
    await page.goto('/');

    // The toggle renders an inert placeholder pre-hydration; wait for the real
    // interactive button (its accessible name starts with "Тема:").
    const toggle = page.getByRole('button', { name: /^Тема:/ });
    await expect(toggle).toBeVisible();

    // Flip the dark class ON.
    await clickUntilDark(page, toggle, true);
    await expect.poll(() => hasDarkClass(page)).toBe(true);

    // Flip the dark class OFF (with an emulated light OS, the system/light steps
    // both clear it).
    await clickUntilDark(page, toggle, false);
    await expect.poll(() => hasDarkClass(page)).toBe(false);
  });
});
