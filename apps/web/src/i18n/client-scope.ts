import type { Messages } from './messages';

/**
 * i18n payload scoping for the CLIENT (`NextIntlClientProvider`).
 *
 * `loadMessages()` (request.ts) still merges ALL namespaces server-side, because
 * Server Components, `getTranslations`, and `generateMetadata` need the full
 * dictionary. This module controls only how much of that dictionary crosses the
 * server→client boundary into the React tree on each route.
 *
 * The ROOT provider ships every namespace touched by globally-mounted client
 * chrome (header / footer / banners / the app-wide `ModalHost` / system pages /
 * dashboard / search / notifications …). A handful of large, route-local
 * namespaces are withheld from root and re-attached by a nested provider in
 * their owning route group — see {@link ROUTE_SCOPED_NAMESPACES}.
 *
 * IMPORTANT — `NextIntlClientProvider` treats `messages` as ATOMIC: a nested
 * provider's `messages` prop REPLACES (does not deep-merge with) the inherited
 * one (use-intl `IntlProvider`: `messages === undefined ? prev : messages`).
 * So a nested provider must pass the GLOBAL set PLUS its own namespace, which is
 * exactly what {@link scopedMessages} produces.
 */

/** A message namespace key (e.g. `'common'`, `'roulette'`). */
export type Namespace = keyof Messages & string;

/**
 * Namespaces withheld from the ROOT client provider because they are used
 * EXCLUSIVELY inside one route group's subtree (grep-verified — see the agent
 * report). Each is re-attached by that group's nested provider.
 *
 * - `legal`    → `app/(legal)` (components/legal/* only; ~30 KB ru — the largest)
 * - `roulette` → `app/(roulette)` (components/roulette/* + features/roulette/*; /video, /voice only)
 * - `settings` → `app/settings`  (components/settings/* + features/settings/* + the settings tab of use-web-push)
 *
 * Everything else stays global: `common, nav, footer, metadata, landing,
 * economy, chrome, misc, social, profile, auth` — each is reached by some
 * globally-mounted client component, so withholding it would render raw keys.
 */
export const ROUTE_SCOPED_NAMESPACES = ['legal', 'roulette', 'settings'] as const;

/**
 * The subset of `messages` shipped to the ROOT `NextIntlClientProvider`: the
 * full server dictionary minus the route-scoped namespaces above.
 */
export function rootClientMessages(messages: Messages): Messages {
  const scoped = new Set<string>(ROUTE_SCOPED_NAMESPACES);
  const out: Messages = {};
  for (const key of Object.keys(messages)) {
    if (!scoped.has(key)) out[key] = messages[key];
  }
  return out;
}

/**
 * Messages for a NESTED route-group provider: the global root set PLUS the named
 * route-scoped namespaces. Because the provider's `messages` prop is atomic, the
 * global set must be re-included so descendants keep access to `common` et al.
 *
 * Any requested namespace that is absent from `messages` is simply skipped (the
 * `ru` fallback still applies via next-intl), so this never throws.
 */
export function scopedMessages(messages: Messages, namespaces: readonly Namespace[]): Messages {
  const out = rootClientMessages(messages);
  for (const ns of namespaces) {
    if (ns in messages) out[ns] = messages[ns];
  }
  return out;
}
