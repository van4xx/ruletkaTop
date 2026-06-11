'use client';

/**
 * Hero card — the user's referral code + shareable link + 3 share buttons
 * (VK, Telegram, native clipboard). The code itself is the canonical primitive;
 * the full link is a server-side rendered convenience so a single press copies
 * a paste-anywhere URL.
 *
 * Share intents:
 *   - VK:        https://vk.com/share.php?url=&title=
 *   - Telegram:  https://t.me/share/url?url=&text=
 *   - Clipboard: navigator.clipboard.writeText (with a Tooltip toast).
 *
 * Toast on copy success/failure is dispatched through the shared `@ruletka/ui`
 * `toast()` helper so the design language stays consistent with the rest of the
 * app (auth flows, gifts, etc.).
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, Send, Share2 } from 'lucide-react';
import { Button, toast } from '@ruletka/ui';

import type { ReferralMeResponse } from '@ruletka/shared-types';

import { cn } from '@/lib/cn';

interface Props {
  data: ReferralMeResponse | undefined;
  isLoading: boolean;
}

export function ReferralLinkCard({ data, isLoading }: Props) {
  const t = useTranslations('social');
  const [justCopied, setJustCopied] = useState<'code' | 'link' | null>(null);

  const copy = async (value: string, what: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(value);
      setJustCopied(what);
      toast.success(t('referrals.copied'));
      // Reset the inline "Copied" affordance after a short window so the user
      // can copy again without a page reload.
      setTimeout(() => setJustCopied(null), 2000);
    } catch {
      toast.error(t('referrals.copyFailed'));
    }
  };

  const shareText = data ? t('referrals.shareText') : '';
  const vkUrl = data
    ? `https://vk.com/share.php?url=${encodeURIComponent(data.link)}&title=${encodeURIComponent(shareText)}`
    : '#';
  const telegramUrl = data
    ? `https://t.me/share/url?url=${encodeURIComponent(data.link)}&text=${encodeURIComponent(shareText)}`
    : '#';

  return (
    <section
      aria-labelledby="ref-link-heading"
      className="relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-card/90 to-card/40 p-6 shadow-[0_0_0_1px_var(--color-border)] sm:p-8"
    >
      {/* Soft accent glow — keeps the card on-brand with the landing aesthetic. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-[radial-gradient(circle,var(--color-neon-violet)_0%,transparent_60%)] opacity-[0.18] blur-2xl"
      />

      <header className="mb-5 flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-card/70 text-[var(--color-neon-violet)] ring-1 ring-border/70">
          <Share2 className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2
            id="ref-link-heading"
            className="font-display text-lg font-semibold leading-tight sm:text-xl"
          >
            {t('referrals.linkCardTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('referrals.linkCardSubtitle')}</p>
        </div>
      </header>

      {/* Code + link inputs, read-only. Generic <input> with manual selection on
          focus so the user can quickly grab the value with keyboard alone. */}
      <div className="flex flex-col gap-3">
        <Field
          label={t('referrals.codeLabel')}
          value={data?.code ?? ''}
          isLoading={isLoading}
          onCopy={data ? () => void copy(data.code, 'code') : undefined}
          copied={justCopied === 'code'}
        />
        <Field
          label={t('referrals.linkLabel')}
          value={data?.link ?? ''}
          isLoading={isLoading}
          onCopy={data ? () => void copy(data.link, 'link') : undefined}
          copied={justCopied === 'link'}
        />
      </div>

      {/* Share intents. Open in a new tab so the user doesn't lose their place. */}
      <div className="mt-5 flex flex-wrap gap-2">
        <a
          href={vkUrl}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!data}
          className={cn(
            'inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/80 px-4 py-2 text-sm font-medium hover:bg-card/95',
            !data && 'pointer-events-none opacity-50',
          )}
        >
          <span aria-hidden="true">VK</span>
          {t('referrals.shareVk')}
        </a>
        <a
          href={telegramUrl}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!data}
          className={cn(
            'inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/80 px-4 py-2 text-sm font-medium hover:bg-card/95',
            !data && 'pointer-events-none opacity-50',
          )}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {t('referrals.shareTelegram')}
        </a>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  isLoading,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  isLoading: boolean;
  onCopy?: () => void;
  copied: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex items-stretch gap-2">
        <input
          readOnly
          value={isLoading ? '' : value}
          aria-busy={isLoading}
          placeholder={isLoading ? '••••••••' : undefined}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 rounded-xl border border-border/70 bg-background/60 px-3 py-2 font-mono text-sm tracking-wide outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!onCopy || isLoading}
          onClick={onCopy}
          aria-label={label}
        >
          {copied ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
    </label>
  );
}
