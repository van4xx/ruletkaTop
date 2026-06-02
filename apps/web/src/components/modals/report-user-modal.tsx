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
import { useTranslations } from 'next-intl';
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

/** The moderation reason enum values, in display order. */
const REASON_VALUES: readonly ReportReason[] = [
  'nudity',
  'harassment',
  'minor',
  'violence',
  'spam',
  'scam',
  'other',
];

export function ReportUserModal() {
  const { close } = useModal();
  const t = useTranslations('chrome');
  const { userId, nickname, matchId } = useModalProps<'report-user'>();

  // Localized label + short hint per moderation reason.
  const REASONS: Array<{ value: ReportReason; label: string; hint: string }> = REASON_VALUES.map(
    (value) => ({
      value,
      label: t(`modals.reportUser.reason${value.charAt(0).toUpperCase()}${value.slice(1)}`),
      hint: t(`modals.reportUser.reason${value.charAt(0).toUpperCase()}${value.slice(1)}Hint`),
    }),
  );

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
        toast.success(t('modals.reportUser.sentTitle'), {
          description: t('modals.reportUser.sentDescription'),
        });
        close();
      },
      onError: (err) => {
        if (err instanceof ApiClientError && err.status === 409) {
          toast.info(t('modals.reportUser.alreadyReported'));
          close();
          return;
        }
        toast.error(t('modals.reportUser.errGeneric'));
      },
    });
  };

  const detailsLen = watch('details')?.length ?? 0;
  const name = nickname?.trim();

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {name ? t('modals.reportUser.titleOnUser', { name }) : t('modals.reportUser.titlePlain')}
        </DialogTitle>
        <DialogDescription>{t('modals.reportUser.description')}</DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Reason picker */}
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm font-medium text-foreground">
            {t('modals.reportUser.reasonLegend')}
          </legend>
          <Controller
            control={control}
            name="reason"
            render={({ field }) => (
              <div
                role="radiogroup"
                aria-label={t('modals.reportUser.reasonGroupAria')}
                className="grid grid-cols-2 gap-2"
              >
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
          <FieldError>{errors.reason && t('modals.reportUser.reasonRequired')}</FieldError>
        </fieldset>

        {/* Details */}
        <div className="space-y-1.5">
          <Label htmlFor="report-details">{t('modals.reportUser.detailsLabel')}</Label>
          <Textarea
            id="report-details"
            rows={3}
            maxLength={1000}
            placeholder={t('modals.reportUser.detailsPlaceholder')}
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
            {t('modals.reportUser.cancel')}
          </Button>
          <Button
            type="submit"
            variant="danger"
            loading={report.isPending}
            leadingIcon={<Flag className="h-4 w-4" />}
          >
            {t('modals.reportUser.submit')}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
