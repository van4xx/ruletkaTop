'use client';

/**
 * Ban-appeal dialog. Surfaced from the login screen when a sign-in is rejected
 * because the account is banned. The user's email + password (the same ones they
 * just typed) re-prove identity to the PUBLIC `POST /moderation/appeal`; the user
 * adds a free-text message stating their case. On success a moderator reviews it.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ShieldAlert } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Spinner,
  Textarea,
  toast,
} from '@ruletka/ui';
import type { CreateAppealDto } from '@ruletka/shared-types';
import { ApiClientError } from '@/lib/api';
import { useSubmitAppeal } from '@/features/auth/use-appeal';

export interface AppealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Email from the login attempt (re-verified server-side). */
  email: string;
  /** Password from the login attempt (re-verified server-side). */
  password: string;
  /** The ban reason surfaced by the login 403, shown read-only for context. */
  banReason: string | null;
}

/** Server enforces a 10-char minimum; mirror it client-side for a friendly gate. */
const MIN_MESSAGE_LENGTH = 10;

export function AppealDialog({ open, onOpenChange, email, password, banReason }: AppealDialogProps) {
  const t = useTranslations('auth');
  const submitAppeal = useSubmitAppeal();
  const [message, setMessage] = useState('');

  const trimmed = message.trim();
  const canSubmit = trimmed.length >= MIN_MESSAGE_LENGTH && !submitAppeal.isPending;

  function submit() {
    if (!canSubmit) return;
    const dto: CreateAppealDto = { email, password, message: trimmed.slice(0, 2000) };
    submitAppeal.mutate(dto, {
      onSuccess: () => {
        toast.success(t('appeal.successTitle'), { description: t('appeal.successDescription') });
        setMessage('');
        onOpenChange(false);
      },
      onError: (err: unknown) => {
        toast.error(appealErrorMessage(err, t));
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-warning" />
            {t('appeal.title')}
          </DialogTitle>
          <DialogDescription>{t('appeal.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {banReason ? (
            <div className="space-y-1.5">
              <Label>{t('appeal.reasonLabel')}</Label>
              <p className="rounded-xl border border-border bg-card/40 px-3.5 py-2.5 text-sm text-muted-foreground">
                {banReason}
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="appeal-message">{t('appeal.messageLabel')}</Label>
            <Textarea
              id="appeal-message"
              value={message}
              maxLength={2000}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('appeal.messagePlaceholder')}
              rows={4}
              autoFocus
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('appeal.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit} className="gap-2">
            {submitAppeal.isPending ? <Spinner size="sm" tone="current" /> : null}
            {t('appeal.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Map an appeal-submit failure to localized copy by HTTP status. */
function appealErrorMessage(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiClientError) {
    if (err.status === 401) return t('appeal.errorInvalidCredentials');
    if (err.status === 403) return t('appeal.errorNotBanned');
    if (err.status === 409) return t('appeal.errorDuplicate');
  }
  return t('appeal.error');
}
