'use client';

/**
 * Change-password dialog. Validates current/new/confirm with a local zod schema
 * (reusing the contract `passwordSchema` for the new password) and calls
 * `useChangePassword`. Closes + toasts on success; surfaces API errors inline.
 *
 * NOTE: targets `POST /auth/change-password` — see the integrator notes if the
 * backend hasn't shipped this endpoint yet.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { CircleAlert } from 'lucide-react';
import { passwordSchema } from '@ruletka/shared-types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  toast,
} from '@ruletka/ui';
import { useChangePassword } from '@/features/settings/use-settings';
import { useFieldError } from '@/features/auth/use-field-error';
import { useErrorMessage } from '@/lib/error-message';
import { FormField } from '@/components/auth/form-field';
import { PasswordField } from '@/components/auth/password-field';

interface FormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export function ChangePasswordDialog({ trigger }: { trigger: ReactNode }) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const fieldError = useFieldError();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const changePassword = useChangePassword();

  // Built inside the component so validation messages can be localized.
  const schema = useMemo(
    () =>
      z
        .object({
          currentPassword: z.string().min(1, t('password.errors.currentRequired')),
          newPassword: passwordSchema,
          confirmPassword: z.string(),
        })
        .refine((v) => v.newPassword === v.confirmPassword, {
          message: t('password.errors.mismatch'),
          path: ['confirmPassword'],
        })
        .refine((v) => v.newPassword !== v.currentPassword, {
          message: t('password.errors.mustDiffer'),
          path: ['newPassword'],
        }),
    [t],
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      reset();
      changePassword.reset();
    }
  };

  const onSubmit = handleSubmit((values) => {
    changePassword.mutate(
      { currentPassword: values.currentPassword, newPassword: values.newPassword },
      {
        onSuccess: () => {
          toast.success(t('password.saved'));
          onOpenChange(false);
        },
      },
    );
  });

  // 401/400 = the current password was wrong. Anything else (network outage,
  // 5xx, unexpected status) goes through the localized helper instead of leaking
  // a raw "Failed to fetch"/server string.
  const apiMessage =
    changePassword.error?.status === 401 || changePassword.error?.status === 400
      ? t('password.errors.currentInvalid')
      : errorMessage(changePassword.error);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('password.title')}</DialogTitle>
          <DialogDescription>{t('password.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {changePassword.isError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-sm text-destructive"
            >
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{apiMessage}</span>
            </div>
          )}

          <FormField
            label={t('password.currentLabel')}
            required
            error={fieldError(errors.currentPassword?.message)}
          >
            {(field) => (
              <PasswordField
                {...field}
                autoComplete="current-password"
                {...register('currentPassword')}
              />
            )}
          </FormField>

          <FormField
            label={t('password.newLabel')}
            required
            error={fieldError(errors.newPassword?.message)}
          >
            {(field) => (
              <PasswordField
                {...field}
                autoComplete="new-password"
                showStrength
                value={watch('newPassword')}
                {...register('newPassword')}
              />
            )}
          </FormField>

          <FormField
            label={t('password.confirmLabel')}
            required
            error={fieldError(errors.confirmPassword?.message)}
          >
            {(field) => (
              <PasswordField
                {...field}
                autoComplete="new-password"
                {...register('confirmPassword')}
              />
            )}
          </FormField>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" variant="primary" loading={changePassword.isPending}>
              {t('password.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
