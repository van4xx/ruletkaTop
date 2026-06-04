import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { adminApi, AdminApiError } from '../lib/api';
import type { AdminSettingFlag, Role } from '../lib/types';
import { Badge, Card, CardHeader, EmptyState, PageHeader, fmtInt } from '../components/kit';

/** Render a flag value as a chip (bool) or plain number/string. */
function FlagValue({ value }: { value: AdminSettingFlag['value'] }) {
  if (typeof value === 'boolean') {
    return <Badge variant={value ? 'success' : 'muted'}>{value ? 'вкл' : 'выкл'}</Badge>;
  }
  if (typeof value === 'number') {
    return <span className="font-display text-sm font-semibold tabular-nums">{fmtInt(value)}</span>;
  }
  return <span className="text-sm">{value}</span>;
}

/**
 * Настройки — platform feature flags + throttle limits (REAL, derived from
 * env/config; secrets reported as a configured/off flag only, never echoed).
 * The PATCH is a Wave-2 stub: env flags require an API restart, so toggling
 * surfaces that note rather than mutating live state.
 */
export function SystemSettings({ role }: { role: Role }) {
  const isAdmin = role === 'admin';
  const settings = useQuery({ queryKey: ['system-settings'], queryFn: () => adminApi.settings.get() });
  const [note, setNote] = useState<string | null>(null);

  async function tryPatch(flag: AdminSettingFlag) {
    if (!isAdmin || typeof flag.value !== 'boolean') return;
    try {
      const res = await adminApi.settings.patch({ key: flag.key, value: !flag.value });
      setNote(res.note);
    } catch (e) {
      setNote(e instanceof AdminApiError ? e.message : 'Не удалось применить');
    }
  }

  return (
    <div>
      <PageHeader title="Настройки" subtitle="Фиче-флаги и лимиты платформы." />

      {note && (
        <Card className="mb-4 text-sm text-warning ring-warning/30">{note}</Card>
      )}

      <Card padding="none">
        <CardHeader title="Фиче-флаги и лимиты" />
        {settings.isLoading ? (
          <div className="grid place-items-center py-12">
            <div className="h-5 w-40 animate-pulse rounded bg-glass" />
          </div>
        ) : settings.isError ? (
          <p className="p-8 text-center text-sm text-danger">Не удалось загрузить настройки.</p>
        ) : (settings.data?.flags.length ?? 0) === 0 ? (
          <EmptyState title="Флагов нет" />
        ) : (
          <ul className="divide-y divide-border/60">
            {settings.data?.flags.map((f) => (
              <li key={f.key} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="font-medium">{f.label}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {f.key}
                    {f.requiresRestart && ' · нужен перезапуск'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!isAdmin || typeof f.value !== 'boolean'}
                  onClick={() => tryPatch(f)}
                  className="shrink-0 disabled:cursor-default"
                  title={isAdmin && typeof f.value === 'boolean' ? 'Переключить' : undefined}
                >
                  <FlagValue value={f.value} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-3 text-xs text-muted-foreground">
        Значения берутся из переменных окружения. Изменение env-флага требует перезапуска API; рантайм-флаги добавит Wave 2.
      </p>
    </div>
  );
}
