'use client';

/**
 * Privacy tab — who can message / call / view profile, plus the online-status
 * toggle. Edits a local draft of `settings.privacy` and PATCHes the diff via
 * `useUpdateSettings`. The save button is enabled only when the draft differs.
 */
import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const update = useUpdateSettings();
  const [draft, setDraft] = useState<PrivacySettings>(settings.privacy);
  const onlineId = useId();

  // Re-sync when the server value changes (e.g. after a successful save).
  useEffect(() => {
    setDraft(settings.privacy);
  }, [settings.privacy]);

  const dirty = !samePrivacy(draft, settings.privacy);

  // Resolve the enum option keys into localized labels for the native select.
  const visibilityOptions = VISIBILITY_OPTIONS.map((o) => ({
    value: o.value,
    label: t(o.labelKey),
  }));

  const save = () => {
    update.mutate(
      { privacy: draft },
      {
        onSuccess: () => toast.success(t('privacy.saved')),
        onError: (e) => toast.error(t('privacy.saveError'), { description: e.message }),
      },
    );
  };

  return (
    <SettingsSection
      title={t('privacy.title')}
      description={t('privacy.description')}
      icon={<ShieldCheck />}
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
      <div className="divide-y divide-border/50">
        <SettingRow
          label={t('privacy.whoCanMessageLabel')}
          description={t('privacy.whoCanMessageDescription')}
          control={
            <Select
              aria-label={t('privacy.whoCanMessageLabel')}
              options={visibilityOptions}
              value={draft.whoCanMessage}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  whoCanMessage: e.target.value as PrivacySettings['whoCanMessage'],
                }))
              }
            />
          }
        />
        <SettingRow
          label={t('privacy.whoCanCallLabel')}
          description={t('privacy.whoCanCallDescription')}
          control={
            <Select
              aria-label={t('privacy.whoCanCallLabel')}
              options={visibilityOptions}
              value={draft.whoCanCall}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  whoCanCall: e.target.value as PrivacySettings['whoCanCall'],
                }))
              }
            />
          }
        />
        <SettingRow
          label={t('privacy.whoCanViewProfileLabel')}
          control={
            <Select
              aria-label={t('privacy.whoCanViewProfileLabel')}
              options={visibilityOptions}
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
          label={t('privacy.showOnlineLabel')}
          htmlFor={onlineId}
          description={t('privacy.showOnlineDescription')}
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
