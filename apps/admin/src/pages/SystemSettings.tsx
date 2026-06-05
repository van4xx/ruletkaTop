import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminApi, AdminApiError } from '../lib/api';
import type { AdminPatchSettingsResult, AdminSettingFlag, Role } from '../lib/types';
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

/** A small switch-style toggle for a live, store-backed boolean flag. */
function Toggle({
  on,
  disabled,
  onClick,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-default disabled:opacity-50 ${
        on ? 'bg-accent' : 'bg-glass ring-1 ring-border/60'
      }`}
    >
      <span
        className={`inline-block size-4 transform rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

/**
 * Настройки — platform feature flags + throttle limits.
 *
 * Flags arrive in TWO groups (REAL — Wave 2):
 *  - LIVE, store-backed (`requiresRestart: false`) — real toggle controls that
 *    PATCH `app_settings` and take effect immediately;
 *  - env/config-derived (`requiresRestart: true`) — read-only, with a "requires
 *    restart/rebuild" note (secrets reported as configured/off only, never
 *    echoed; an env var can't be flipped at runtime).
 */
export function SystemSettings({ role }: { role: Role }) {
  const isAdmin = role === 'admin';
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['system-settings'], queryFn: () => adminApi.settings.get() });
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  const patch = useMutation({
    mutationFn: (flag: AdminSettingFlag) =>
      adminApi.settings.patch({ key: flag.key, value: !flag.value }),
    onSuccess: (res: AdminPatchSettingsResult) => {
      setNote({ text: res.note, ok: res.applied });
      if (res.applied) qc.invalidateQueries({ queryKey: ['system-settings'] });
    },
    onError: (e) =>
      setNote({ text: e instanceof AdminApiError ? e.message : 'Не удалось применить', ok: false }),
  });

  const flags = settings.data?.flags ?? [];
  const liveFlags = flags.filter((f) => !f.requiresRestart);
  const envFlags = flags.filter((f) => f.requiresRestart);

  return (
    <div>
      <PageHeader title="Настройки" subtitle="Фиче-флаги и лимиты платформы." />

      {note && (
        <Card className={`mb-4 text-sm ${note.ok ? 'text-success ring-success/30' : 'text-warning ring-warning/30'}`}>
          {note.text}
        </Card>
      )}

      {settings.isLoading ? (
        <Card padding="none">
          <div className="grid place-items-center py-12">
            <div className="h-5 w-40 animate-pulse rounded bg-glass" />
          </div>
        </Card>
      ) : settings.isError ? (
        <Card className="text-sm text-danger ring-danger/30">Не удалось загрузить настройки.</Card>
      ) : flags.length === 0 ? (
        <Card padding="none">
          <EmptyState title="Флагов нет" />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Live, store-backed — real toggles. */}
          <Card padding="none">
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  Рантайм-настройки
                  <Badge variant="success">применяются сразу</Badge>
                </span>
              }
            />
            {liveFlags.length === 0 ? (
              <EmptyState title="Нет рантайм-флагов" />
            ) : (
              <ul className="divide-y divide-border/60">
                {liveFlags.map((f) => (
                  <li key={f.key} className="flex items-center justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="font-medium">{f.label}</p>
                      <p className="font-mono text-xs text-muted-foreground">{f.key}</p>
                    </div>
                    {typeof f.value === 'boolean' ? (
                      <Toggle
                        on={f.value}
                        disabled={!isAdmin || patch.isPending}
                        onClick={() => {
                          setNote(null);
                          patch.mutate(f);
                        }}
                      />
                    ) : (
                      <FlagValue value={f.value} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Env/config-derived — read-only, requires restart/rebuild. */}
          <Card padding="none">
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  Переменные окружения
                  <Badge variant="muted">нужен перезапуск/пересборка</Badge>
                </span>
              }
            />
            <ul className="divide-y divide-border/60">
              {envFlags.map((f) => (
                <li key={f.key} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="font-medium">{f.label}</p>
                    <p className="font-mono text-xs text-muted-foreground">{f.key} · только чтение</p>
                  </div>
                  <FlagValue value={f.value} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Рантайм-настройки хранятся в БД и применяются сразу. Значения из переменных окружения
        (включая секреты и NEXT_PUBLIC_*) меняются только через окружение — нужен перезапуск или
        пересборка API.
      </p>
    </div>
  );
}
