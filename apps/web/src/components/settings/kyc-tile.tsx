'use client';

/**
 * "Подтверждение возраста" tile for the Privacy / safety section.
 *
 * Renders the user's current KYC status as a glass card with a single primary
 * button ("Начать проверку" / "Открыть провайдера") that hits POST /kyc/start
 * and follows the redirectUrl in a NEW TAB. When the provider's webhook fires,
 * the next `useKycStatus()` refetch flips the status to `approved` and the
 * tile collapses to a "verified" state.
 *
 * The tile is informational only — the matchmaking gate that consults the same
 * state is opt-in via the API's `KYC_REQUIRED` env (default OFF), so this tile
 * ships without changing any user's flow.
 */
import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, toast } from '@ruletka/ui';

import { useKycStatus, useStartKyc } from '@/features/kyc/use-kyc-status';

import { SettingRow, SettingsSection } from './primitives';

export function KycTile() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const status = useKycStatus();
  const start = useStartKyc();

  const verified = status.data?.ageVerified ?? false;
  const row = status.data?.verification ?? null;

  const statusLabel = verified
    ? t('kyc.statusApproved')
    : row?.status === 'pending'
      ? t('kyc.statusPending')
      : row?.status === 'rejected'
        ? t('kyc.statusRejected')
        : row?.status === 'expired'
          ? t('kyc.statusExpired')
          : t('kyc.statusNone');

  const ctaLabel = verified ? t('kyc.ctaVerified') : t('kyc.ctaStart');

  const onClick = () => {
    if (verified) {
      return;
    }
    start.mutate(undefined, {
      onError: (err) => {
        toast.error(t('kyc.startError'), { description: err.message });
      },
    });
  };

  return (
    <SettingsSection
      title={t('kyc.title')}
      description={t('kyc.description')}
      icon={<ShieldCheck />}
    >
      <SettingRow
        label={t('kyc.statusLabel')}
        description={statusLabel}
        control={
          <Button
            variant="primary"
            disabled={verified || start.isPending || status.isLoading}
            loading={start.isPending}
            onClick={onClick}
          >
            {status.isLoading ? tc('loading') : ctaLabel}
          </Button>
        }
      />
    </SettingsSection>
  );
}
