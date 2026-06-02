'use client';

/**
 * Change-password dialog. Validates current/new/confirm with a local zod schema
 * (reusing the contract `passwordSchema` for the new password) and calls
 * `useChangePassword`. Closes + toasts on success; surfaces API errors inline.
 *
 * NOTE: targets `POST /auth/change-password` — see the integrator notes if the
 * backend hasn't shipped this endpoint yet.
 */
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import { FormField } from '@/components/auth/form-field';
import { PasswordField } from '@/components/auth/password-field';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Введите текущий пароль'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Пароли не совпадают',
    path: ['confirmPassword'],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'Новый пароль должен отличаться',
    path: ['newPassword'],
  });
type FormValues = z.infer<typeof schema>;

export function ChangePasswordDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const changePassword = useChangePassword();

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
          toast.success('Пароль изменён');
          onOpenChange(false);
        },
      },
    );
  });

  const apiMessage =
    changePassword.error?.status === 401 || changePassword.error?.status === 400
      ? 'Текущий пароль неверный'
      : changePassword.error?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Смена пароля</DialogTitle>
          <DialogDescription>
            Введите текущий пароль и новый — не короче 8 символов.
          </DialogDescription>
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

          <FormField label="Текущий пароль" required error={errors.currentPassword?.message}>
            {(field) => (
              <PasswordField {...field} autoComplete="current-password" {...register('currentPassword')} />
            )}
          </FormField>

          <FormField label="Новый пароль" required error={errors.newPassword?.message}>
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

          <FormField label="Повторите новый пароль" required error={errors.confirmPassword?.message}>
            {(field) => (
              <PasswordField {...field} autoComplete="new-password" {...register('confirmPassword')} />
            )}
          </FormField>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" variant="primary" loading={changePassword.isPending}>
              Сменить пароль
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
