'use client';

/**
 * Privacy tab — who can message / call / view profile, plus the online-status
 * toggle. Edits a local draft of `settings.privacy` and PATCHes the diff via
 * `useUpdateSettings`. The save button is enabled only when the draft differs.
 */
import { useEffect, useId, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { PrivacySettings, Settings } from '@ruletka/shared-types';
import { Button, Switch, toast } from '@ruletka/ui';
import { useUpdateSettings } from '@/features/settings/use-settings';
import { VISIBILITY_OPTIONS } from '@/features/settings/options';
import { SettingRow, SettingsSection, Select } from '../primitives';

function samePrivacy(a: PrivacySettings, b: PrivacySettings): boolean {
  return (
    a.whoCanMessage === b.whoCanMessage &&
    a.whoCanCall === b.whoCanCall &&
    a.whoCanViewProfile === b.whoCanViewProfile &&
    a.showOnlineStatus === b.showOnlineStatus
  );
}

export function PrivacyTab({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const [draft, setDraft] = useState<PrivacySettings>(settings.privacy);
  const onlineId = useId();

  // Re-sync when the server value changes (e.g. after a successful save).
  useEffect(() => {
    setDraft(settings.privacy);
  }, [settings.privacy]);

  const dirty = !samePrivacy(draft, settings.privacy);

  const save = () => {
    update.mutate(
      { privacy: draft },
      {
        onSuccess: () => toast.success('Настройки приватности сохранены'),
        onError: (e) => toast.error('Не удалось сохранить', { description: e.message }),
      },
    );
  };

  return (
    <SettingsSection
      title="Приватность"
      description="Контролируй, кто может с тобой связаться и видеть твой профиль."
      icon={<ShieldCheck />}
      footer={
        <>
          {dirty && <span className="mr-auto text-xs text-muted-foreground">Есть несохранённые изменения</span>}
          <Button
            variant="primary"
            disabled={!dirty}
            loading={update.isPending}
            onClick={save}
          >
            Сохранить
          </Button>
        </>
      }
    >
      <div className="divide-y divide-border/50">
        <SettingRow
          label="Кто может писать сообщения"
          description="Личные сообщения от пользователей вне списка будут скрыты."
          control={
            <Select
              aria-label="Кто может писать сообщения"
              options={VISIBILITY_OPTIONS}
              value={draft.whoCanMessage}
              onChange={(e) =>
                setDraft((d) => ({ ...d, whoCanMessage: e.target.value as PrivacySettings['whoCanMessage'] }))
              }
            />
          }
        />
        <SettingRow
          label="Кто может звонить"
          description="Входящие звонки от остальных будут отклоняться."
          control={
            <Select
              aria-label="Кто может звонить"
              options={VISIBILITY_OPTIONS}
              value={draft.whoCanCall}
              onChange={(e) =>
                setDraft((d) => ({ ...d, whoCanCall: e.target.value as PrivacySettings['whoCanCall'] }))
              }
            />
          }
        />
        <SettingRow
          label="Кто видит профиль"
          control={
            <Select
              aria-label="Кто видит профиль"
              options={VISIBILITY_OPTIONS}
              value={draft.whoCanViewProfile}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  whoCanViewProfile: e.target.value as PrivacySettings['whoCanViewProfile'],
                }))
              }
            />
          }
        />
        <SettingRow
          label="Показывать статус «в сети»"
          htmlFor={onlineId}
          description="Другие будут видеть, когда ты онлайн."
          control={
            <Switch
              id={onlineId}
              checked={draft.showOnlineStatus}
              onCheckedChange={(checked) => setDraft((d) => ({ ...d, showOnlineStatus: checked }))}
            />
          }
        />
      </div>
    </SettingsSection>
  );
}
