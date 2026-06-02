import { test, expect, type Page } from '@playwright/test';

/**
 * Auth screens (`/login`, `/register`).
 *
 * Asserts both forms render their core fields + submit, and that client-side
 * (zod) validation surfaces an error on an empty submit. A full, real
 * registration round-trip against the API is attempted best-effort and is
 * guarded so a missing/unhealthy backend never fails the UI assertions.
 */

// NOTE on selectors: required fields decorate their <label> with a
// visually-hidden "required" suffix, which pollutes the control's accessible
// name (e.g. "Парольrequired"). Rather than depend on localized, decorated
// label text, we address the inputs by their stable `name` attribute (supplied
// by react-hook-form's `register(...)`), which is unambiguous and resilient.

/** The email field (`<input name="email" type="email">`). */
const emailField = (page: Page) => page.locator('input[name="email"]');
/** The password field (`<input name="password">`, native `type=password`). */
const passwordField = (page: Page) => page.locator('input[name="password"]');
/** The nickname field (register only). */
const nicknameField = (page: Page) => page.locator('input[name="nickname"]');
/** The birth-date field (register only). */
const birthDateField = (page: Page) => page.locator('input[name="birthDate"]');

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('renders the login form (email, password, submit)', async ({ page }) => {
    // The form's own heading is the <h1>; the brand-side "pitch" is an <h2>, so
    // pin the level to disambiguate.
    await expect(page.getByRole('heading', { level: 1, name: 'С возвращением' })).toBeVisible();

    await expect(emailField(page)).toBeVisible();
    await expect(emailField(page)).toHaveAttribute('type', 'email');

    await expect(passwordField(page)).toBeVisible();
    await expect(passwordField(page)).toHaveAttribute('type', 'password');

    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();

    // The cross-link to registration is present.
    await expect(page.getByRole('link', { name: 'Создать' })).toHaveAttribute('href', '/register');
  });

  test('shows a validation error on empty submit', async ({ page }) => {
    // The form is `noValidate`, so submitting empty runs the zod resolver
    // rather than native browser validation.
    await page.getByRole('button', { name: 'Войти' }).click();

    // Field-level errors render as role="alert" messages.
    await expect(page.getByRole('alert').first()).toBeVisible();

    // We must NOT have navigated away on an invalid submit.
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Register page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/register');
  });

  test('renders the registration form (email, password, submit)', async ({ page }) => {
    // The form heading is the <h1> (the brand-side pitch is an <h2>).
    await expect(page.getByRole('heading', { level: 1, name: 'Создать аккаунт' })).toBeVisible();

    await expect(emailField(page)).toBeVisible();
    await expect(passwordField(page)).toBeVisible();
    await expect(passwordField(page)).toHaveAttribute('type', 'password');

    // The submit button (a separate "Создать аккаунт" from the heading).
    await expect(page.getByRole('button', { name: 'Создать аккаунт' })).toBeVisible();

    await expect(page.getByRole('link', { name: 'Войти' })).toHaveAttribute('href', '/login');
  });

  test('shows a validation error on empty submit', async ({ page }) => {
    await page.getByRole('button', { name: 'Создать аккаунт' }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
  });

  test('best-effort: submitting a filled registration is handled gracefully', async ({ page }) => {
    // Fill the free-text fields with a unique, schema-valid registrant. 18+ is
    // enforced client-side via the birth date.
    const stamp = Date.now();
    await emailField(page).fill(`e2e_${stamp}@example.com`);
    await nicknameField(page).fill(`e2e_${stamp}`.slice(0, 24));
    await passwordField(page).fill('Sup3rSecret!42');
    await birthDateField(page).fill('1995-06-15');

    // Country is a required custom combobox (`role="combobox"`, name "Страна").
    // Driving it end-to-end is brittle, so it is strictly best-effort: open it
    // and pick the first option. Any hiccup is swallowed — the final assertion
    // tolerates BOTH the "registered" and the "client validation stopped me (no
    // country)" outcomes, so a missing/odd backend or an un-selected country
    // never hard-fails the UI contract this test guards.
    const heading = page.getByRole('heading', { level: 1, name: 'Создать аккаунт' });
    try {
      await page.getByRole('combobox', { name: 'Страна' }).click({ timeout: 3_000 });
      await page
        .getByRole('listbox', { name: 'Countries' })
        .getByRole('option')
        .first()
        .click({ timeout: 3_000 });
    } catch {
      /* best-effort selection */
    }

    // ALWAYS dismiss any open popover before submitting, regardless of how the
    // country step went: clicking a neutral element (the form heading) closes
    // the combobox so its search field can't intercept the submit click.
    await heading.click();
    await expect(page.getByRole('listbox', { name: 'Countries' })).toBeHidden();

    // Submit. With a backend up + country chosen → redirect to home; otherwise a
    // handled error banner or client-side validation keeps us on /register. We
    // assert only that the app handles it gracefully (no crash / blank shell):
    // the site header (banner) stays mounted throughout. Scope to the banner —
    // the auth shell renders its own brand link inside <main>, so an unscoped
    // brand-link query would be ambiguous.
    await page.getByRole('button', { name: 'Создать аккаунт' }).click();
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'ruletka.top — на главную' }),
    ).toBeVisible();

    if (/\/register/.test(page.url())) {
      // Stayed put → there must be a *handled* signal (field validation or an
      // API error banner), not a silent freeze.
      await expect(page.getByRole('alert').first()).toBeVisible();
    } else {
      // Navigated away → the success path.
      await expect(page).not.toHaveURL(/\/register/);
    }
  });
});
