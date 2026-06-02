'use client';

/**
 * Report a user for moderation. Validates against the shared
 * `createReportSchema` (reason enum + optional details) and submits to
 * `POST /reports`. The reason is chosen from accessible radio cards; details
 * are optional free text (max 1000).
 */
import { useMutation } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Flag } from 'lucide-react';
import {
  createReportSchema,
  type CreateReportDto,
  type Report,
  type ReportReason,
} from '@ruletka/shared-types';
import {
  Button,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
  toast,
} from '@ruletka/ui';
import { api, ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useModal, useModalProps } from '@/lib/stores/modal-store';
import { FieldError } from './shared';

/** Russian labels + short hints for each moderation reason. */
const REASONS: Array<{ value: ReportReason; label: string; hint: string }> = [
  { value: 'nudity', label: 'Нагота / 18+', hint: 'Откровенный контент' },
  { value: 'harassment', label: 'Оскорбления', hint: 'Травля, угрозы' },
  { value: 'minor', label: 'Несовершеннолетний', hint: 'Похоже, это ребёнок' },
  { value: 'violence', label: 'Насилие', hint: 'Жестокий контент' },
  { value: 'spam', label: 'Спам', hint: 'Реклама, флуд' },
  { value: 'scam', label: 'Мошенничество', hint: 'Обман, попрошайничество' },
  { value: 'other', label: 'Другое', hint: 'Опишите ниже' },
];

export function ReportUserModal() {
  const { close } = useModal();
  const { userId, nickname, matchId } = useModalProps<'report-user'>();

  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<CreateReportDto>({
    resolver: zodResolver(createReportSchema),
    defaultValues: {
      againstUserId: userId,
      matchId,
      reason: undefined as unknown as ReportReason,
      details: '',
    },
  });

  const report = useMutation({
    mutationFn: (dto: CreateReportDto) =>
      api.request<Report>('/reports', { method: 'POST', json: dto }),
  });

  const onSubmit = (values: CreateReportDto) => {
    // Drop an empty details string so the optional field stays unset.
    const payload: CreateReportDto = {
      ...values,
      details: values.details?.trim() ? values.details.trim() : undefined,
    };
    report.mutate(payload, {
      onSuccess: () => {
        toast.success('Жалоба отправлена', {
          description: 'Спасибо — модераторы рассмотрят её в ближайшее время.',
        });
        close();
      },
      onError: (err) => {
        if (err instanceof ApiClientError && err.status === 409) {
          toast.info('Вы уже пожаловались на этого пользователя');
          close();
          return;
        }
        toast.error('Не удалось отправить жалобу');
      },
    });
  };

  const detailsLen = watch('details')?.length ?? 0;
  const name = nickname?.trim();

  return (
    <>
      <DialogHeader>
        <DialogTitle>Пожаловаться{name ? ` на ${name}` : ''}</DialogTitle>
        <DialogDescription>
          Расскажите, что не так. Жалобы анонимны и помогают делать рулетку безопаснее.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Reason picker */}
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm font-medium text-foreground">Причина</legend>
          <Controller
            control={control}
            name="reason"
            render={({ field }) => (
              <div role="radiogroup" aria-label="Причина жалобы" className="grid grid-cols-2 gap-2">
                {REASONS.map((r) => {
                  const selected = field.value === r.value;
                  return (
                    <button
                      key={r.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => field.onChange(r.value)}
                      className={cn(
                        'flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        selected
                          ? 'border-accent-muted bg-accent-soft'
                          : 'border-border bg-card/40 hover:border-border-strong hover:bg-card/70',
                      )}
                    >
                      <span className="text-sm font-medium text-foreground">{r.label}</span>
                      <span className="text-xs text-muted-foreground">{r.hint}</span>
                    </button>
                  );
                })}
              </div>
            )}
          />
          <FieldError>{errors.reason && 'Выберите причину жалобы.'}</FieldError>
        </fieldset>

        {/* Details */}
        <div className="space-y-1.5">
          <Label htmlFor="report-details">Подробности (необязательно)</Label>
          <Textarea
            id="report-details"
            rows={3}
            maxLength={1000}
            placeholder="Что произошло? Чем больше деталей, тем лучше."
            invalid={!!errors.details}
            {...register('details')}
          />
          <div className="flex items-center justify-between">
            <FieldError>{errors.details?.message}</FieldError>
            <span className="ml-auto text-xs tabular-nums text-subtle-foreground">
              {detailsLen}/1000
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Отмена
          </Button>
          <Button
            type="submit"
            variant="danger"
            loading={report.isPending}
            leadingIcon={<Flag className="h-4 w-4" />}
          >
            Отправить жалобу
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
