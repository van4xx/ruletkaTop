import { test, expect } from '@playwright/test';

/**
 * Video roulette (`/video`).
 *
 * The stage shows a "sign in to start" prompt when there is no session, so to
 * exercise the actual controls we seed a token into localStorage BEFORE the app
 * boots. We set ONLY the access token (not a refresh token): the auth
 * bootstrapper's `/auth/me` revalidation is gated on a *full* persisted session
 * (access + refresh), so this avoids any backend round-trip that could clear the
 * token — while `useAuthToken` still reports a token and renders the controls.
 *
 * We never click "Начать": that would request real camera/microphone media.
 */

/**
 * Mirrors `ACCESS_TOKEN_STORAGE_KEY` from
 * `src/hooks/roulette/use-auth-token.ts` (and the auth store's `ACCESS_KEY`).
 * Inlined so this spec carries no `'use client'` import graph into Playwright's
 * bundler. Keep in sync if that key ever changes.
 */
const ACCESS_TOKEN_STORAGE_KEY = 'ruletka.accessToken';
const FAKE_ACCESS_TOKEN = 'e2e.fake.access-token';

test.describe('Video roulette controls', () => {
  test.beforeEach(async ({ context, page }) => {
    // Seed the token before any app script runs in every page of the context.
    await context.addInitScript(
      ([key, value]) => {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          /* storage unavailable — the test will surface the sign-in screen */
        }
      },
      [ACCESS_TOKEN_STORAGE_KEY, FAKE_ACCESS_TOKEN] as const,
    );
    await page.goto('/video');
  });

  test('renders the Start and Filters controls', async ({ page }) => {
    // Idle stage → primary Start action (a button, surfaced by the control bar)
    // and the Filters trigger. Both prove we are NOT on the sign-in screen.
    await expect(page.getByRole('button', { name: 'Начать' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Фильтры' })).toBeVisible();

    // Sanity: the sign-in prompt is NOT what we are looking at.
    await expect(page.getByText('Войдите, чтобы начать')).toHaveCount(0);
  });

  test('opening Filters shows gender, age-range and country controls', async ({ page }) => {
    await page.getByRole('button', { name: 'Фильтры' }).click();

    // The dialog is open.
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Фильтры поиска' })).toBeVisible();

    const dialog = page.getByRole('dialog');

    // Gender: an accessible radiogroup with the three options.
    const genderGroup = dialog.getByRole('radiogroup', { name: 'Пол собеседника' });
    await expect(genderGroup).toBeVisible();
    await expect(genderGroup.getByRole('radio', { name: 'Любой' })).toBeVisible();
    await expect(genderGroup.getByRole('radio', { name: 'Парни' })).toBeVisible();
    await expect(genderGroup.getByRole('radio', { name: 'Девушки' })).toBeVisible();

    // Age range: the free-for-everyone control. Its section label is "Возраст"
    // and it is a two-thumb range slider exposed via the "Диапазон возраста"
    // group — assert the control itself rather than the (dash-formatted) value
    // text, which would be brittle.
    await expect(dialog.getByText('Возраст', { exact: true })).toBeVisible();
    const ageSlider = dialog.getByLabel('Диапазон возраста');
    await expect(ageSlider).toBeVisible();
    // A range slider renders one thumb (role="slider") per bound (min + max).
    await expect(ageSlider.getByRole('slider')).toHaveCount(2);

    // Country control: present (label "Страны"). For a non-premium session it is
    // a disabled "Любая страна" affordance; either way the section exists.
    await expect(dialog.getByText('Страны', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Любая страна')).toBeVisible();
  });
});
