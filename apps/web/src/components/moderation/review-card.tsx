'use client';

/**
 * A single admin review-queue card: blurred evidence thumbnail (click to
 * reveal — the frame is NSFW by definition), the model's label + confidence,
 * the auto-action already taken, a relative timestamp, and uphold/dismiss
 * actions. Matches the app's dark, glass aesthetic.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Check, Eye, EyeOff, ShieldAlert, VideoOff, X } from 'lucide-react';
import { Badge, Button } from '@ruletka/ui';
import type { ModerationAction, ModerationLabel, ReviewItem } from '@ruletka/shared-types';
import { formatRelativeTime } from '@/features/chat/lib/format';
import { cn } from '@/lib/cn';

type BadgeVariant = 'danger' | 'warning' | 'neutral';

/** `misc.moderation.*` label key + Badge treatment per moderation label. */
const LABEL_META: Record<ModerationLabel, { labelKey: string; variant: BadgeVariant }> = {
  minor: { labelKey: 'moderation.labelMinor', variant: 'danger' },
  sexual: { labelKey: 'moderation.labelSexual', variant: 'danger' },
  nudity: { labelKey: 'moderation.labelNudity', variant: 'warning' },
  violence: { labelKey: 'moderation.labelViolence', variant: 'warning' },
  other: { labelKey: 'moderation.labelOther', variant: 'neutral' },
  safe: { labelKey: 'moderation.labelSafe', variant: 'neutral' },
};

/** `misc.moderation.*` label key per auto-action. */
const ACTION_META: Record<ModerationAction, { labelKey: string; variant: BadgeVariant }> = {
  ban: { labelKey: 'moderation.actionBan', variant: 'danger' },
  kick: { labelKey: 'moderation.actionKick', variant: 'warning' },
  warn: { labelKey: 'moderation.actionWarn', variant: 'warning' },
  blur: { labelKey: 'moderation.actionBlur', variant: 'neutral' },
  none: { labelKey: 'moderation.actionNone', variant: 'neutral' },
};

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export interface ReviewCardProps {
  item: ReviewItem;
  onResolve: (id: string, resolution: 'uphold' | 'dismiss') => void;
  /** True while a resolve mutation for this card is in flight. */
  pending?: boolean;
}

export function ReviewCard({ item, onResolve, pending = false }: ReviewCardProps) {
  const t = useTranslations('misc');
  // Evidence is NSFW — keep it blurred until the moderator opts to view it.
  const [revealed, setRevealed] = useState(false);

  const labelMeta = LABEL_META[item.label] ?? LABEL_META.other;
  const actionMeta = ACTION_META[item.autoAction] ?? ACTION_META.none;
  const scorePct = Math.round((Number.isFinite(item.score) ? item.score : 0) * 100);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.4, ease: EASE_OUT }}
      className="glass-panel flex flex-col overflow-hidden rounded-2xl"
    >
      {/* Evidence */}
      <div className="relative aspect-video w-full bg-black/50">
        {item.evidenceUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.evidenceUrl}
              alt={t('moderation.evidenceAlt')}
              className={cn(
                'h-full w-full object-cover transition-[filter] duration-200',
                !revealed && 'blur-2xl brightness-50',
              )}
            />
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              className={cn(
                'absolute inset-0 grid place-items-center text-white/90',
                'transition-colors hover:bg-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
              aria-label={
                revealed ? t('moderation.hideEvidenceAria') : t('moderation.showEvidenceAria')
              }
            >
              {!revealed && (
                <span className="inline-flex flex-col items-center gap-1.5 rounded-xl bg-black/50 px-4 py-3 text-xs font-medium backdrop-blur-sm">
                  <Eye className="h-5 w-5" aria-hidden="true" />
                  {t('moderation.showFrame')}
                </span>
              )}
              {revealed && (
                <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-lg bg-black/55 px-2 py-1 text-[0.625rem] font-medium backdrop-blur-sm">
                  <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('moderation.hide')}
                </span>
              )}
            </button>
          </>
        ) : (
          <div className="grid h-full place-items-center text-muted-foreground">
            <span className="inline-flex flex-col items-center gap-1.5 text-xs">
              <VideoOff className="h-6 w-6" aria-hidden="true" />
              {t('moderation.evidenceUnavailable')}
            </span>
          </div>
        )}
        {/* Score chip */}
        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-lg bg-black/55 px-2 py-1 text-[0.6875rem] font-semibold text-white backdrop-blur-sm">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
          {scorePct}%
        </span>
      </div>

      {/* Meta + actions */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={labelMeta.variant}>{t(labelMeta.labelKey)}</Badge>
          <Badge variant={actionMeta.variant} size="sm">
            {t(actionMeta.labelKey)}
          </Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            {formatRelativeTime(item.createdAt)}
          </span>
        </div>

        <dl className="space-y-0.5 text-xs text-muted-foreground">
          <div className="flex gap-1.5">
            <dt className="shrink-0 font-medium text-foreground/80">{t('moderation.user')}</dt>
            <dd className="truncate font-mono">{item.userId}</dd>
          </div>
          {item.matchId && (
            <div className="flex gap-1.5">
              <dt className="shrink-0 font-medium text-foreground/80">{t('moderation.match')}</dt>
              <dd className="truncate font-mono">{item.matchId}</dd>
            </div>
          )}
        </dl>

        <div className="mt-auto flex items-center gap-2 pt-1">
          <Button
            variant="danger"
            size="sm"
            className="flex-1 gap-1.5"
            loading={pending}
            onClick={() => onResolve(item.id, 'uphold')}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            {t('moderation.confirm')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5"
            disabled={pending}
            onClick={() => onResolve(item.id, 'dismiss')}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            {t('moderation.dismiss')}
          </Button>
        </div>
      </div>
    </motion.article>
  );
}
