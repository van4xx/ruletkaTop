/*
 * ruletka.top service worker — Web Push delivery.
 *
 * Scope: registered from the app root (`/sw.js`, scope `/`). It owns exactly two
 * responsibilities and nothing else (no offline/caching strategy — this is a
 * realtime app, not an offline PWA):
 *   1. `push`            — render the incoming notification.
 *   2. `notificationclick` — focus an existing tab or open the deep link.
 *
 * Payload contract: the API sends a JSON body shaped like the in-app
 * notification — `{ title, body, kind?, link?, id? }`. We tolerate a missing or
 * non-JSON payload (some push services send an empty "wake up" push) and fall
 * back to a generic message so we always satisfy the `userVisibleOnly` promise.
 */

self.addEventListener('install', (event) => {
  // Activate this worker immediately on first install (no waiting for old tabs).
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  // Take control of already-open clients so pushes work without a reload.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (_e) {
      // Non-JSON payload — surface the raw text as the body.
      data = { body: event.data.text() };
    }
  }

  const title = data.title || 'ruletka.top';
  const options = {
    body: data.body || 'Новое уведомление',
    icon: data.icon || '/favicon.svg',
    badge: data.badge || '/favicon.svg',
    // Coalesce repeat pushes of the same logical event into one notification.
    tag: data.tag || data.kind || 'ruletka',
    renotify: Boolean(data.renotify),
    // Carry the deep link + id through to the click handler.
    data: {
      link: data.link || '/notifications',
      id: data.id || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetPath = (event.notification.data && event.notification.data.link) || '/notifications';
  // Resolve to an absolute URL within our origin for matching + opening.
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Prefer focusing an already-open tab on our origin and navigating it.
        for (const client of clientList) {
          if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
            return client.focus().then((focused) => {
              if ('navigate' in focused) {
                return focused.navigate(targetUrl).catch(() => focused);
              }
              return focused;
            });
          }
        }
        // Otherwise open a fresh tab at the deep link.
        if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
        return undefined;
      }),
  );
});
