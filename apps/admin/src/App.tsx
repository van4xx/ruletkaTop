import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Button, Input, Spinner } from '@ruletka/ui';
import type { AuthUser, Role } from '@ruletka/shared-types';
import { adminApi, AdminApiError } from './lib/api';
import { Dashboard } from './pages/Dashboard';
import { Moderation } from './pages/Moderation';
import { Users } from './pages/Users';
import { Economy } from './pages/Economy';

const isStaff = (role?: string) => role === 'admin' || role === 'moderator';

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
      setError(err instanceof AdminApiError && err.status === 401 ? 'Неверный email или пароль' : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm glass-strong rounded-2xl p-7 shadow-xl">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-xl bg-aurora text-sm font-bold text-white">R</span>
          <div>
            <p className="font-display text-lg font-bold leading-none">ruletka.top</p>
            <p className="text-xs text-muted-foreground">Админ-панель</p>
          </div>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input type="password" placeholder="Пароль" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" variant="primary" block loading={busy}>
            Войти
          </Button>
        </form>
      </div>
    </div>
  );
}

/* ────────────────────────────────── Shell ────────────────────────────────── */
const NAV = [
  { to: '/', label: 'Дашборд', end: true },
  { to: '/moderation', label: 'Модерация' },
  { to: '/users', label: 'Пользователи' },
  { to: '/economy', label: 'Экономика' },
];

function Shell({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const navigate = useNavigate();
  async function logout() {
    await adminApi.logout();
    onLogout();
    navigate('/');
  }
  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col gap-1 border-r border-border bg-background-elevated/40 p-4">
        <div className="mb-6 flex items-center gap-2 px-2">
          <span className="grid size-8 place-items-center rounded-lg bg-aurora text-sm font-bold text-white">R</span>
          <span className="font-display font-bold">Админ</span>
        </div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `rounded-xl px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-glass text-foreground' : 'text-muted-foreground hover:bg-glass/60 hover:text-foreground'}`
            }
          >
            {n.label}
          </NavLink>
        ))}
        <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
          <p className="px-2 text-xs text-muted-foreground">
            {user.nickname} · <span className="capitalize">{user.role}</span>
          </p>
          <Button variant="ghost" size="sm" onClick={logout}>
            Выйти
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6 lg:p-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/moderation" element={<Moderation />} />
          <Route path="/users" element={<Users role={user.role as Role} />} />
          <Route path="/economy" element={<Economy />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
