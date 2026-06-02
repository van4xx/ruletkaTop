'use client';

/**
 * Notifications tab — push / email master switches plus per-category toggles
 * (friend requests, messages, gifts). Local draft + diff PATCH, mirroring the
 * Privacy tab. Category toggles dim when both delivery channels are off.
 */
import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Bell,
  Gift,
  Mail,
  MessageSquare,
  MonitorSmartphone,
  Smartphone,
  UserPlus,
} from 'lucide-react';
import type { NotificationSettings, Settings } from '@ruletka/shared-types';
import { Button, Switch, toast } from '@ruletka/ui';
import { useUpdateSettings } from '@/features/settings/use-settings';
import { useWebPush } from '@/features/notifications/use-web-push';
import { SettingRow, SettingsSection } from '../primitives';

/**
 * Per-browser Web Push enable/disable. Hidden entirely when push isn't
 * configured (no VAPID public key) or the browser can't do Web Push — so the
 * app stays a clean no-op without secrets. When the browser has hard-denied
 * permission, the toggle is disabled with an explanatory hint.
 */
function PushDeviceRow() {
  const t = useTranslations('settings');
  const { supported, subscribed, permission, busy, error, enable, disable } = useWebPush();
  const id = useId();

  // Keyless / unsupported → render nothing (no-op default).
  if (!supported) return null;

  const denied = permission === 'denied';
  const description = denied
    ? t('notifications.pushBrowserDescriptionDenied')
    : error
      ? error
      : t('notifications.pushBrowserDescriptionDefault');

  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('notifications.thisDeviceHeading')}
      </p>
      <div className="divide-y divide-border/50">
        <SettingRow
          label={
            <span className="inline-flex items-center gap-2">
              <MonitorSmartphone
                className="h-4 w-4 text-[var(--color-neon-magenta)]"
                aria-hidden="true"
              />
              {t('notifications.pushBrowserLabel')}
            </span>
          }
          htmlFor={id}
          description={description}
          control={
            <Switch
              id={id}
              checked={subscribed}
              disabled={busy || denied}
              onCheckedChange={(v) => {
                void (v ? enable() : disable());
              }}
            />
          }
        />
      </div>
    </div>
  );
}

type NotifKey = keyof NotificationSettings;

function sameNotif(a: NotificationSettings, b: NotificationSettings): boolean {
  return (Object.keys(a) as NotifKey[]).every((k) => a[k] === b[k]);
}

export function NotificationsTab({ settings }: { settings: Settings }) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const update = useUpdateSettings();
  const [draft, setDraft] = useState<NotificationSettings>(settings.notifications);

  useEffect(() => {
    setDraft(settings.notifications);
  }, [settings.notifications]);

  const dirty = !sameNotif(draft, settings.notifications);
  const channelsOff = !draft.pushEnabled && !draft.emailEnabled;

  const set = (key: NotifKey, value: boolean) => setDraft((d) => ({ ...d, [key]: value }));

  const save = () => {
    update.mutate(
      { notifications: draft },
      {
        onSuccess: () => toast.success(t('notifications.saved')),
        onError: (e) => toast.error(t('notifications.saveError'), { description: e.message }),
      },
    );
  };

  const pushId = useId();
  const emailId = useId();
  const frId = useId();
  const msgId = useId();
  const giftId = useId();

  return (
    <SettingsSection
      title={t('notifications.title')}
      description={t('notifications.description')}
      icon={<Bell />}
      footer={
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
      }
    >
      <div className="space-y-6">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('notifications.channelsHeading')}
          </p>
          <div className="divide-y divide-border/50">
            <SettingRow
              label={
                <span className="inline-flex items-center gap-2">
                  <Smartphone
                    className="h-4 w-4 text-[var(--color-neon-violet)]"
                    aria-hidden="true"
                  />
                  {t('notifications.pushLabel')}
                </span>
              }
              htmlFor={pushId}
              description={t('notifications.pushDescription')}
              control={
                <Switch
                  id={pushId}
                  checked={draft.pushEnabled}
                  onCheckedChange={(v) => set('pushEnabled', v)}
                />
              }
            />
            <SettingRow
              label={
                <span className="inline-flex items-center gap-2">
                  <Mail className="h-4 w-4 text-[var(--color-neon-cyan)]" aria-hidden="true" />
                  {t('notifications.emailLabel')}
                </span>
              }
              htmlFor={emailId}
              description={t('notifications.emailDescription')}
              control={
                <Switch
                  id={emailId}
                  checked={draft.emailEnabled}
                  onCheckedChange={(v) => set('emailEnabled', v)}
                />
              }
            />
          </div>
        </div>

        <PushDeviceRow />

        <div
          className={
            channelsOff ? 'pointer-events-none opacity-50 transition-opacity' : 'transition-opacity'
          }
        >
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('notifications.eventsHeading')}
          </p>
          <div className="divide-y divide-border/50">
            <SettingRow
              label={
                <span className="inline-flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {t('notifications.friendRequestsLabel')}
                </span>
              }
              htmlFor={frId}
              control={
                <Switch
                  id={frId}
                  checked={draft.friendRequests}
                  disabled={channelsOff}
                  onCheckedChange={(v) => set('friendRequests', v)}
                />
              }
            />
            <SettingRow
              label={
                <span className="inline-flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {t('notifications.messagesLabel')}
                </span>
              }
              htmlFor={msgId}
              control={
                <Switch
                  id={msgId}
                  checked={draft.messages}
                  disabled={channelsOff}
                  onCheckedChange={(v) => set('messages', v)}
                />
              }
            />
            <SettingRow
              label={
                <span className="inline-flex items-center gap-2">
                  <Gift className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {t('notifications.giftsLabel')}
                </span>
              }
              htmlFor={giftId}
              control={
                <Switch
                  id={giftId}
                  checked={draft.gifts}
                  disabled={channelsOff}
                  onCheckedChange={(v) => set('gifts', v)}
                />
              }
            />
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
