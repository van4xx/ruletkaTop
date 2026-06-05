import {
  Suspense,
  lazy,
  useEffect,
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Button, Input, Spinner } from '@ruletka/ui';
import type { AuthUser, Role } from '@ruletka/shared-types';

import { adminApi, AdminApiError } from './lib/api';

const isStaff = (role?: string) => role === 'admin' || role === 'moderator';

/* ───────────────────────── lazy-loaded section pages ──────────────────────── */
/** Adapt a named export to the default-export shape `React.lazy` expects. */
function page<P>(loader: () => Promise<Record<string, ComponentType<P>>>, name: string) {
  return lazy(async () => {
    const mod = await loader();
    const Comp = mod[name];
    if (!Comp) throw new Error(`Admin page export "${name}" not found`);
    return { default: Comp };
  });
}

const Dashboard = page(() => import('./pages/Dashboard'), 'Dashboard');
const Users = page<{ role: Role }>(() => import('./pages/Users'), 'Users');
const Balances = page<{ role: Role }>(() => import('./pages/Balances'), 'Balances');
const Premium = page<{ role: Role }>(() => import('./pages/Premium'), 'Premium');
const Economy = page(() => import('./pages/Economy'), 'Economy');
const Payments = page(() => import('./pages/Payments'), 'Payments');
const Moderation = page(() => import('./pages/Moderation'), 'Moderation');
const Calls = page(() => import('./pages/Calls'), 'Calls');
const Content = page<{ role: Role }>(() => import('./pages/Content'), 'Content');
const Broadcast = page<{ role: Role }>(() => import('./pages/Broadcast'), 'Broadcast');
const Security = page(() => import('./pages/Security'), 'Security');
const SystemSettings = page<{ role: Role }>(
  () => import('./pages/SystemSettings'),
  'SystemSettings',
);
const Audit = page(() => import('./pages/Audit'), 'Audit');

/* ───────────────────────────── Root / auth gate ──────────────────────────── */
export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    adminApi.bootstrap().then((u) => {
      setUser(u && isStaff(u.role) ? u : null);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background text-foreground">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Login onLogin={setUser} />;
  return <Shell user={user} onLogout={() => setUser(null)} />;
}

/* ───────────────────────────────── Login ─────────────────────────────────── */
function Login({ onLogin }: { onLogin: (u: AuthUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await adminApi.login(email, password);
      if (!isStaff(u.role)) {
        await adminApi.logout();
        setError('Недостаточно прав: нужен доступ модератора или администратора.');
        return;
      }
      onLogin(u);
    } catch (err) {
      setError(
        err instanceof AdminApiError && err.status === 401
          ? 'Неверный email или пароль'
          : 'Не удалось войти',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm glass-strong rounded-2xl p-7 shadow-xl">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-xl bg-aurora text-sm font-bold text-white">
            R
          </span>
          <div>
            <p className="font-display text-lg font-bold leading-none">ruletka.top</p>
            <p className="text-xs text-muted-foreground">Админ-панель</p>
          </div>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input
            type="email"
            placeholder="Email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Пароль"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" variant="primary" block loading={busy}>
            Войти
          </Button>
        </form>
      </div>
    </div>
  );
}

/* ──────────────────────────── Navigation model ───────────────────────────── */
interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  icon: ReactNode;
  /** Lowest role that may see this item. Defaults to `moderator`. */
  minRole?: Role;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Inline stroke icons (no icon dependency) — 20px, currentColor. */
const I = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" strokeLinecap="round" />
      <path d="M16 5.5a3 3 0 0 1 0 5.8M17.5 19a5.2 5.2 0 0 0-2.5-4.4" strokeLinecap="round" />
    </svg>
  ),
  wallet: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14" r="1.2" />
    </svg>
  ),
  premium: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <path d="M3 8l4.5 3L12 5l4.5 6L21 8l-1.7 10.5H4.7L3 8Z" strokeLinejoin="round" />
    </svg>
  ),
  economy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <circle cx="12" cy="12" r="8.5" />
      <path
        d="M12 7v10M9.5 9.5h4a1.8 1.8 0 0 1 0 3.6h-3a1.8 1.8 0 0 0 0 3.6h4"
        strokeLinecap="round"
      />
    </svg>
  ),
  payments: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 9.5h19M6.5 15h4" strokeLinecap="round" />
    </svg>
  ),
  moderation: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" strokeLinejoin="round" />
      <path d="M9.5 12l1.8 1.8 3.5-3.6" strokeLinecap="round" />
    </svg>
  ),
  calls: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <rect x="3" y="6" width="12" height="12" rx="2.5" />
      <path d="M15 10.5l6-3v9l-6-3" strokeLinejoin="round" />
    </svg>
  ),
  content: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M7.5 13h9M7.5 16.5h5" strokeLinecap="round" />
    </svg>
  ),
  broadcast: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <path d="M4 10v4l9 4V6l-9 4Z" strokeLinejoin="round" />
      <path d="M13 8.5a4 4 0 0 1 0 7" strokeLinecap="round" />
    </svg>
  ),
  security: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" strokeLinecap="round" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"
        strokeLinecap="round"
      />
    </svg>
  ),
  audit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <path d="M6 3h8l4 4v14H6V3Z" strokeLinejoin="round" />
      <path d="M14 3v4h4M9 12h6M9 15.5h6M9 8.5h2" strokeLinecap="round" />
    </svg>
  ),
};

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Обзор',
    items: [{ to: '/', label: 'Дашборд', end: true, icon: I.dashboard }],
  },
  {
    title: 'Люди',
    items: [
      { to: '/users', label: 'Пользователи', icon: I.users },
      { to: '/calls', label: 'Звонки', icon: I.calls },
    ],
  },
  {
    title: 'Деньги',
    items: [
      { to: '/balances', label: 'Баланс', icon: I.wallet, minRole: 'admin' },
      { to: '/premium', label: 'Премиум', icon: I.premium, minRole: 'admin' },
      { to: '/economy', label: 'Экономика', icon: I.economy },
      { to: '/payments', label: 'Платежи', icon: I.payments, minRole: 'admin' },
    ],
  },
  {
    title: 'Модерация',
    items: [
      { to: '/moderation', label: 'Модерация', icon: I.moderation },
      { to: '/content', label: 'Контент', icon: I.content },
      { to: '/broadcast', label: 'Рассылки', icon: I.broadcast },
    ],
  },
  {
    title: 'Система',
    items: [
      { to: '/security', label: 'Безопасность', icon: I.security, minRole: 'admin' },
      { to: '/settings', label: 'Настройки', icon: I.settings },
      { to: '/audit', label: 'Аудит', icon: I.audit },
    ],
  },
];

/** All nav items flattened (for the header title lookup). */
const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

const ROLE_RANK: Record<Role, number> = { user: 0, moderator: 1, admin: 2 };
/** Whether `role` may see an item gated to `minRole` (default moderator). */
function canSee(role: Role, minRole: Role = 'moderator'): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

/* ────────────────────────────────── Shell ────────────────────────────────── */
function Shell({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const role = user.role as Role;
  const [mobileOpen, setMobileOpen] = useState(false);

  async function logout() {
    await adminApi.logout();
    onLogout();
    navigate('/');
  }

  // Close the mobile drawer on navigation.
  useEffect(() => setMobileOpen(false), [location.pathname]);

  const current = ALL_ITEMS.find((i) =>
    i.end ? location.pathname === i.to : location.pathname.startsWith(i.to) && i.to !== '/',
  );
  const title = current?.label ?? 'Дашборд';

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      {/* Sidebar */}
      <Sidebar
        role={role}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onLogout={logout}
        user={user}
      />

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Sticky header */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-md lg:px-8">
          <button
            className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-glass hover:text-foreground lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Меню"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>
          <h1 className="font-display text-lg font-bold tracking-tight">{title}</h1>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-none">{user.nickname}</p>
              <p className="text-xs capitalize text-muted-foreground">{user.role}</p>
            </div>
            <span className="grid size-9 place-items-center rounded-full bg-aurora text-sm font-bold text-white">
              {(user.nickname || '?').charAt(0).toUpperCase()}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <Suspense
            fallback={
              <div className="grid place-items-center py-24">
                <Spinner />
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/users" element={<Users role={role} />} />
              <Route path="/calls" element={<Calls />} />
              <Route path="/economy" element={<Economy />} />
              <Route path="/moderation" element={<Moderation />} />
              <Route path="/content" element={<Content role={role} />} />
              <Route path="/broadcast" element={<Broadcast role={role} />} />
              <Route path="/settings" element={<SystemSettings role={role} />} />
              <Route path="/audit" element={<Audit />} />

              {/* Admin-only sections — gated by role, redirect a moderator home. */}
              {canSee(role, 'admin') ? (
                <>
                  <Route path="/balances" element={<Balances role={role} />} />
                  <Route path="/premium" element={<Premium role={role} />} />
                  <Route path="/payments" element={<Payments />} />
                  <Route path="/security" element={<Security />} />
                </>
              ) : null}

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

/* ───────────────────────────────── Sidebar ───────────────────────────────── */
function Sidebar({
  role,
  mobileOpen,
  onClose,
  onLogout,
  user,
}: {
  role: Role;
  mobileOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
  user: AuthUser;
}) {
  const nav = (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto">
      {NAV_GROUPS.map((group) => {
        const visible = group.items.filter((i) => canSee(role, i.minRole));
        if (visible.length === 0) return null;
        return (
          <div key={group.title}>
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {group.title}
            </p>
            <div className="flex flex-col gap-0.5">
              {visible.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-glass text-foreground'
                        : 'text-muted-foreground hover:bg-glass/60 hover:text-foreground'
                    }`
                  }
                >
                  <span className="shrink-0">{n.icon}</span>
                  {n.label}
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );

  const inner = (
    <>
      <div className="mb-6 flex items-center gap-2 px-2">
        <span className="grid size-8 place-items-center rounded-lg bg-aurora text-sm font-bold text-white">
          R
        </span>
        <span className="font-display font-bold">Админ</span>
      </div>
      {nav}
      <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
        <p className="px-2 text-xs text-muted-foreground">
          {user.nickname} · <span className="capitalize">{user.role}</span>
        </p>
        <Button variant="ghost" size="sm" onClick={onLogout}>
          Выйти
        </Button>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-background-elevated/40 p-4 lg:flex">
        {inner}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={onClose}>
          <div className="absolute inset-0 bg-background-overlay/70 backdrop-blur-sm" />
          <aside
            className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-border bg-background-elevated p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {inner}
          </aside>
        </div>
      )}
    </>
  );
}
