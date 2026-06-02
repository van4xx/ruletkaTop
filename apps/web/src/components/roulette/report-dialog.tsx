'use client';

/**
 * Report dialog (`POST /reports`). Lets the user pick a reason and add optional
 * details. On submit it auto-skips to the next peer (reporting implies you no
 * longer want to talk to this one) — the parent decides via `onReported`.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Flag } from 'lucide-react';
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
import { type CreateReportDto, type ReportReason } from '@ruletka/shared-types';
import { useReportUser } from '@/hooks/roulette/use-roulette-api';
import { cn } from '@/lib/cn';

export interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  againstUserId: string;
  peerName: string;
  /** Called after a successful report (parent typically skips to next). */
  onReported?: () => void;
}

const REASONS: { value: ReportReason; labelKey: string }[] = [
  { value: 'nudity', labelKey: 'report.reasonNudity' },
  { value: 'harassment', labelKey: 'report.reasonHarassment' },
  { value: 'minor', labelKey: 'report.reasonMinor' },
  { value: 'violence', labelKey: 'report.reasonViolence' },
  { value: 'spam', labelKey: 'report.reasonSpam' },
  { value: 'scam', labelKey: 'report.reasonScam' },
  { value: 'other', labelKey: 'report.reasonOther' },
];

export function ReportDialog({
  open,
  onOpenChange,
  againstUserId,
  peerName,
  onReported,
}: ReportDialogProps) {
  const t = useTranslations('roulette');
  const report = useReportUser();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');

  function submit() {
    if (!reason) return;
    const dto: CreateReportDto = {
      againstUserId,
      reason,
      details: details.trim() ? details.trim().slice(0, 1000) : undefined,
    };
    report.mutate(dto, {
      onSuccess: () => {
        toast.success(t('report.successTitle'), {
          description: t('report.successDescription'),
        });
        setReason(null);
        setDetails('');
        onOpenChange(false);
        onReported?.();
      },
      onError: (err: unknown) => {
        toast.error(err instanceof Error ? err.message : t('report.error'));
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-5 w-5 text-warning" />
            {t('report.title', { name: peerName })}
          </DialogTitle>
          <DialogDescription>{t('report.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            role="radiogroup"
            aria-label={t('report.reasonGroupAriaLabel')}
            className="grid grid-cols-2 gap-2"
          >
            {REASONS.map((r) => {
              const selected = reason === r.value;
              return (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setReason(r.value)}
                  className={cn(
                    'rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected
                      ? 'border-warning/60 bg-warning/15 text-foreground'
                      : 'border-border bg-card/40 text-muted-foreground hover:text-foreground hover:bg-card/70',
                  )}
                >
                  {t(r.labelKey)}
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="report-details">{t('report.detailsLabel')}</Label>
            <Textarea
              id="report-details"
              value={details}
              maxLength={1000}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={t('report.detailsPlaceholder')}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('report.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={!reason || report.isPending}
            onClick={submit}
            className="gap-2"
          >
            {report.isPending ? <Spinner size="sm" tone="current" /> : <Flag className="h-4 w-4" />}
            {t('report.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
