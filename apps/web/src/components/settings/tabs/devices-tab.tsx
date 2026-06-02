'use client';

/**
 * Devices tab — preferred camera + microphone pickers backed by
 * `navigator.mediaDevices.enumerateDevices` (via `useDevices`). Device labels
 * are only available after a permission grant, so we show a prompt CTA when
 * they're hidden. The chosen device ids persist to `settings.devices`.
 *
 * Handles three non-happy states: unsupported browser, permission not yet
 * granted (labels hidden), and no devices found.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, Mic, MonitorSmartphone, ShieldAlert, Video } from 'lucide-react';
import type { DeviceSettings, Settings } from '@ruletka/shared-types';
import { Button, toast } from '@ruletka/ui';
import { useDevices } from '@/features/settings/use-devices';
import { useUpdateSettings } from '@/features/settings/use-settings';
import { SettingRow, SettingsSection, Select, type SelectOption } from '../primitives';

export function DevicesTab({ settings }: { settings: Settings }) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const { cameras, microphones, permission, supported, loading, error, requestPermission } =
    useDevices();
  const update = useUpdateSettings();
  const [draft, setDraft] = useState<DeviceSettings>(settings.devices);

  useEffect(() => setDraft(settings.devices), [settings.devices]);

  const dirty =
    draft.preferredCameraId !== settings.devices.preferredCameraId ||
    draft.preferredMicId !== settings.devices.preferredMicId;

  const labelsHidden = supported && permission !== 'granted' && cameras.every((c) => !c.label);

  const save = () => {
    update.mutate(
      { devices: draft },
      {
        onSuccess: () => toast.success(t('devices.saved')),
        onError: (e) => toast.error(t('devices.saveError'), { description: e.message }),
      },
    );
  };

  const auto: SelectOption = { value: '', label: t('devices.auto') };
  const cameraOptions: SelectOption[] = [
    auto,
    ...cameras.map((c) => ({ value: c.deviceId, label: c.label })),
  ];
  const micOptions: SelectOption[] = [
    auto,
    ...microphones.map((m) => ({ value: m.deviceId, label: m.label })),
  ];

  return (
    <SettingsSection
      title={t('devices.title')}
      description={t('devices.description')}
      icon={<MonitorSmartphone />}
      footer={
        supported && !labelsHidden ? (
          <>
            {dirty && (
              <span className="mr-auto text-xs text-muted-foreground">
                {t('shell.unsavedChanges')}
              </span>
            )}
            <Button variant="primary" disabled={!dirty} loading={update.isPending} onClick={save}>
              {tc('save')}
            </Button>
          </>
        ) : undefined
      }
    >
      {!supported ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <ShieldAlert className="h-8 w-8 text-warning" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{t('devices.unsupported')}</p>
        </div>
      ) : labelsHidden ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border/70 py-10 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-card/70 ring-1 ring-border/70">
            <Video className="h-6 w-6 text-[var(--color-neon-violet)]" aria-hidden="true" />
          </span>
          <div className="max-w-xs space-y-1">
            <p className="text-sm font-medium text-foreground">{t('devices.permissionTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('devices.permissionDescription')}</p>
          </div>
          <Button variant="secondary" onClick={requestPermission}>
            {t('devices.permissionCta')}
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          <SettingRow
            label={
              <span className="inline-flex items-center gap-2">
                <Camera className="h-4 w-4 text-[var(--color-neon-violet)]" aria-hidden="true" />
                {t('devices.cameraLabel')}
              </span>
            }
            description={
              loading ? t('devices.refreshing') : t('devices.found', { count: cameras.length })
            }
            control={
              <Select
                aria-label={t('devices.cameraSelectAria')}
                options={cameraOptions}
                value={draft.preferredCameraId ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, preferredCameraId: e.target.value || null }))
                }
              />
            }
          />
          <SettingRow
            label={
              <span className="inline-flex items-center gap-2">
                <Mic className="h-4 w-4 text-[var(--color-neon-cyan)]" aria-hidden="true" />
                {t('devices.micLabel')}
              </span>
            }
            description={
              loading ? t('devices.refreshing') : t('devices.found', { count: microphones.length })
            }
            control={
              <Select
                aria-label={t('devices.micSelectAria')}
                options={micOptions}
                value={draft.preferredMicId ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, preferredMicId: e.target.value || null }))
                }
              />
            }
          />
          {error && <p className="pt-3 text-xs text-destructive">{error}</p>}
        </div>
      )}
    </SettingsSection>
  );
}
