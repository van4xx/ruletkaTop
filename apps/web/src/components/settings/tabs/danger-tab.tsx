'use client';

/**
 * Danger zone — irreversible account deletion behind a typed confirmation.
 *
 * The user must type their nickname to enable the destructive button (a
 * deliberate friction gate). On success we clear the auth session and bounce to
 * the landing page. Targets `DELETE /auth/me` — see integrator notes if the
 * backend hasn't shipped it yet.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CircleAlert, TriangleAlert } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  toast,
} from '@ruletka/ui';
import { useAuth } from '@/features/auth/use-auth';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useDeleteAccount } from '@/features/settings/use-settings';
import { useErrorMessage } from '@/lib/error-message';
import { disconnectSocket } from '@/lib/socket';
import { SettingsSection } from '../primitives';

export function DangerTab() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const { user } = useAuth();
  const clear = useAuthStore((s) => s.clear);
  const router = useRouter();
  const deleteAccount = useDeleteAccount();

  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const confirmTarget = user?.nickname ?? '';
  const canDelete = confirmText.trim() === confirmTarget && confirmTarget.length > 0;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setConfirmText('');
      deleteAccount.reset();
    }
  };

  const handleDelete = () => {
    if (!canDelete) return;
    deleteAccount.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('danger.deleted'));
        clear();
        disconnectSocket();
        router.replace('/');
      },
      onError: (e) => toast.error(t('danger.deleteError'), { description: e.message }),
    });
  };

  return (
    <SettingsSection
      title={t('danger.title')}
      description={t('danger.description')}
      icon={<TriangleAlert />}
      className="border border-destructive/30"
    >
      <div className="flex flex-col gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{t('danger.deleteHeading')}</p>
          <p className="max-w-md text-xs text-muted-foreground">{t('danger.deleteDescription')}</p>
        </div>

        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger asChild>
            <Button variant="danger" className="shrink-0">
              {t('danger.deleteButton')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('danger.dialogTitle')}</DialogTitle>
              <DialogDescription>
                {t.rich('danger.dialogDescription', {
                  nickname: confirmTarget,
                  strong: (chunks) => (
                    <span className="font-semibold text-foreground">{chunks}</span>
                  ),
                })}
              </DialogDescription>
            </DialogHeader>

            {deleteAccount.isError && (
              <div
                role="alert"
                className="mb-2 flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-sm text-destructive"
              >
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{errorMessage(deleteAccount.error)}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="confirm-delete">{t('danger.nicknameLabel')}</Label>
              <Input
                id="confirm-delete"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={confirmTarget}
                autoComplete="off"
                invalid={confirmText.length > 0 && !canDelete}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={!canDelete}
                loading={deleteAccount.isPending}
                onClick={handleDelete}
              >
                {t('danger.confirmDelete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </SettingsSection>
  );
}
