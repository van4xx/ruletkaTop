/**
 * Edge middleware — route protection for ruletka.top.
 *
 * ─────────────────────────── Token strategy ───────────────────────────────
 * The auth store (`src/lib/stores/auth-store.ts`) mirrors the access token into
 * a non-httpOnly **marker cookie** (`ruletka_auth`) on login/refresh and clears
 * it on logout. Middleware runs on the edge and can only read cookies (not
 * localStorage), so it uses the *presence* of that cookie as a fast "is this
 * person signed in?" signal to gate protected routes before any protected HTML
 * is sent.
 *
 * This is intentionally a lightweight guard, not the security boundary: every
 * API request is still authenticated by the bearer token and validated
 * server-side, and `<RequireAuth>` covers client-side navigations after a
 * session expires. The cookie only decides which page shell to serve.
 *
 *   - Unauthenticated → protected route  ⇒  redirect to /login?next=<path>
 *   - Authenticated   → /login or /register ⇒ redirect to / (or ?next)
 */
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp } from '@/lib/csp';

/** Cookie written by the auth store; mirrors `AUTH_COOKIE` there. */
const AUTH_COOKIE = 'ruletka_auth';

/** Routes that require an authenticated session. */
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/settings',
  '/friends',
  '/chats',
  '/profile/me',
  '/wallet',
  '/notifications',
] as const;

/** Auth screens an already-authenticated user should be bounced away from. */
const AUTH_ROUTES = ['/login', '/register'] as const;

/** Where signed-in users land instead of the marketing landing. */
const AUTHED_HOME = '/dashboard';

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/** Only follow same-origin, absolute-path `next` targets (no open redirects). */
function safeNext(next: string | null): string {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return '/';
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const isAuthed = Boolean(request.cookies.get(AUTH_COOKIE)?.value);

  // Gate protected routes for signed-out visitors.
  if (!isAuthed && isProtected(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  // Keep signed-in users out of the auth screens.
  if (isAuthed && isAuthRoute(pathname)) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get('next');
    // After auth, land on the explicit `next` (if safe) or the dashboard hub.
    url.pathname = next ? safeNext(next) : AUTHED_HOME;
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Signed-in visitors get the personalised hub instead of the marketing page.
  if (isAuthed && pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = AUTHED_HOME;
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Serve the page. In PRODUCTION, attach a per-request CSP nonce so `script-src`
  // can drop `'unsafe-inline'`: Next reads the nonce from the request's CSP header
  // and stamps it onto its own bootstrap/flight scripts. Dev keeps no CSP (HMR
  // needs inline + eval), so the dev experience is unchanged.
  if (process.env.NODE_ENV !== 'production') {
    return NextResponse.next();
  }
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

/**
 * Run on app routes only — skip Next internals, the API proxy and static
 * assets (anything with a file extension). This keeps the matcher cheap.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|.*\\.[\\w]+$).*)'],
};
