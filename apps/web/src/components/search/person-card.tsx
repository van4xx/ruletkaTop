'use client';

/**
 * A discovery person card: avatar (premium aurora ring), nickname + badges,
 * gender · age · country meta, and quick actions — open profile, add friend
 * (POST /friends/request), and send a gift (opens the shared gift dialog).
 * Mirrors the friend-card interaction language so discovery feels native.
 */
import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Check, Gift, UserPlus } from 'lucide-react';
import type { PublicProfile } from '@ruletka/shared-types';
import {
  Avatar,
  Button,
  codeToFlag,
  COUNTRY_BY_CODE,
  IconButton,
  Skeleton,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { ApiClientError } from '@/lib/api';
import { useSendFriendRequest } from '@/features/friends/use-friends';
import { ProfileBadges } from '@/components/social/profile-badges';
import { SendGiftDialog } from '@/components/profile/send-gift-dialog';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-card/60 px-2.5 py-0.5 text-xs text-foreground/85 ring-1 ring-border/60">
      {children}
    </span>
  );
}

export function PersonCard({ profile, index = 0 }: { profile: PublicProfile; index?: number }) {
  const t = useTranslations('misc');
  const tp = useTranslations('profile');
  const country = COUNTRY_BY_CODE.get(profile.country);
  const sendRequest = useSendFriendRequest();
  const [sent, setSent] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  const profileHref = `/profile/${profile.id}`;

  function addFriend() {
    sendRequest.mutate(profile.id, {
      onSuccess: () => {
        setSent(true);
        toast.success(t('search.requestSentTitle'), {
          description: t('search.requestSentDesc', { name: profile.nickname }),
        });
      },
      onError: (err) => {
        if (err instanceof ApiClientError && err.status === 409) {
          setSent(true);
          toast.info(t('search.requestExists'));
        } else {
          toast.error(t('search.requestError'));
        }
      },
    });
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE_OUT, delay: Math.min(index, 12) * 0.04 }}
        className="glass-panel group flex h-full flex-col gap-4 rounded-2xl p-4 transition-[transform,background-color] duration-300 hover:-translate-y-0.5 hover:bg-card/70"
      >
        <div className="flex items-start gap-3">
          <Link
            href={profileHref}
            className="shrink-0 rounded-full"
            aria-label={t('search.profileAria', { name: profile.nickname })}
          >
            <Avatar
              src={profile.avatarUrl}
              alt={profile.nickname}
              size="lg"
              ring={profile.isPremium ? 'aurora' : 'none'}
            />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Link
                href={profileHref}
                className="truncate font-display text-base font-semibold tracking-tight transition-colors hover:text-[var(--color-neon-cyan)]"
              >
                {profile.nickname}
              </Link>
              <ProfileBadges badges={profile.badges} size="sm" iconOnly />
            </div>
            {profile.status && (
              <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{profile.status}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <MetaChip>{tp(`gender.${profile.gender}`)}</MetaChip>
          <MetaChip>{tp('age', { age: profile.age })}</MetaChip>
          <MetaChip>
            <span aria-hidden="true">{codeToFlag(profile.country)}</span>
            <span className="truncate">{country?.name ?? profile.country}</span>
          </MetaChip>
        </div>

        <div className="mt-auto flex items-center gap-2 pt-1">
          <Button
            variant={sent ? 'secondary' : 'primary'}
            size="sm"
            className="flex-1"
            leadingIcon={sent ? <Check className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            loading={sendRequest.isPending}
            disabled={sent}
            onClick={addFriend}
          >
            {sent ? t('search.addFriendSent') : t('search.addFriend')}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton
                variant="glass"
                size="sm"
                aria-label={t('search.sendGiftAria', { name: profile.nickname })}
                onClick={() => setGiftOpen(true)}
              >
                <Gift aria-hidden="true" />
              </IconButton>
            </TooltipTrigger>
            <TooltipContent>{t('search.sendGiftTooltip')}</TooltipContent>
          </Tooltip>
        </div>
      </motion.div>

      <SendGiftDialog
        open={giftOpen}
        onOpenChange={setGiftOpen}
        recipientId={profile.id}
        recipientName={profile.nickname}
      />
    </>
  );
}

/** Skeleton mirroring the person card while discovery resolves. */
export function PersonCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('glass-panel flex h-full flex-col gap-4 rounded-2xl p-4', className)} aria-hidden="true">
      <div className="flex items-start gap-3">
        <Skeleton shape="circle" className="h-14 w-14 shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <div className="flex gap-1.5">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-12 rounded-full" />
      </div>
      <Skeleton className="mt-auto h-9 w-full rounded-md" />
    </div>
  );
}
