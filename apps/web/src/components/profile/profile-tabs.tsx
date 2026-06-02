'use client';

/**
 * Tabbed profile sections — Подарки / О себе / Активность — built on the design
 * system's Radix `Tabs` (roving focus, arrow-key nav, a11y wired) with a
 * framer-motion cross-fade between panels.
 *
 *   • Подарки    — the {@link GiftsShowcase} (received gifts).
 *   • О себе      — identity details (bio, languages, country, member-since).
 *   • Активность  — recent activity; gracefully empty until an activity API
 *                  lands (the gifts already received double as a light feed).
 */
import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Activity as ActivityIcon,
  CalendarDays,
  Gift as GiftIcon,
  Globe2,
  Languages,
  Sparkles,
  UserRound,
} from 'lucide-react';
import type { OnlineStatus, PublicProfile } from '@ruletka/shared-types';
import { Tabs, TabsList, TabsTrigger, codeToFlag, COUNTRY_BY_CODE } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { ErrorState } from '@/components/social/state-views';
import { InterestChips } from './interest-chips';
import { GENDER_LABEL, ageLabel } from './profile-meta';
import { GiftsShowcase } from './gifts-showcase';
import type { ReceivedGift } from '@/features/profile/use-profile';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

type TabKey = 'gifts' | 'about' | 'activity';

export function ProfileTabs({
  profile,
  status,
  gifts,
  giftsLoading,
  giftsError,
  giftsValueCoins,
  onRetryGifts,
  isOwnProfile,
}: {
  profile: PublicProfile;
  status?: OnlineStatus;
  gifts: ReceivedGift[];
  giftsLoading: boolean;
  giftsError: boolean;
  giftsValueCoins: number;
  onRetryGifts: () => void;
  isOwnProfile?: boolean;
}) {
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<TabKey>('gifts');

  const transition = reduce
    ? { duration: 0.12 }
    : { duration: 0.28, ease: EASE_OUT };

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
      <TabsList block className="w-full">
        <TabsTrigger value="gifts">
          <GiftIcon aria-hidden="true" />
          Подарки
        </TabsTrigger>
        <TabsTrigger value="about">
          <UserRound aria-hidden="true" />О себе
        </TabsTrigger>
        <TabsTrigger value="activity">
          <ActivityIcon aria-hidden="true" />
          Активность
        </TabsTrigger>
      </TabsList>

      {/* Animated panel region. Radix keeps a11y wiring; we own the transition. */}
      <div className="glass-panel mt-4 rounded-3xl p-5 sm:p-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -8 }}
            transition={transition}
            // Region is labelled by the active tab for screen readers.
            role="region"
            aria-label={
              tab === 'gifts' ? 'Подарки' : tab === 'about' ? 'О себе' : 'Активность'
            }
          >
            {tab === 'gifts' &&
              (giftsError ? (
                <ErrorState onRetry={onRetryGifts} description="Не удалось загрузить подарки." />
              ) : (
                <GiftsShowcase
                  gifts={gifts}
                  isLoading={giftsLoading}
                  totalValueCoins={giftsValueCoins}
                  emptyTitle={isOwnProfile ? 'У вас пока нет подарков' : 'Пока нет подарков'}
                  emptyHint={
                    isOwnProfile
                      ? 'Подарки от собеседников появятся здесь — выходите в эфир и общайтесь.'
                      : 'Станьте первым, кто подарит что-нибудь.'
                  }
                />
              ))}

            {tab === 'about' && <AboutPanel profile={profile} />}

            {tab === 'activity' && (
              <ActivityPanel profile={profile} status={status} gifts={gifts} isLoading={giftsLoading} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </Tabs>
  );
}

/* ── О себе ───────────────────────────────────────────────────────────── */

function AboutPanel({ profile }: { profile: PublicProfile }) {
  const country = COUNTRY_BY_CODE.get(profile.country);
  const joined = new Date(profile.createdAt).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const rows: Array<{ icon: typeof Globe2; label: string; value: React.ReactNode }> = [
    { icon: UserRound, label: 'Пол · возраст', value: `${GENDER_LABEL[profile.gender]} · ${ageLabel(profile.age)}` },
    {
      icon: Globe2,
      label: 'Страна',
      value: (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true">{codeToFlag(profile.country)}</span>
          {country?.name ?? profile.country}
        </span>
      ),
    },
    {
      icon: Languages,
      label: 'Языки',
      value: profile.languages.length ? (
        <span className="uppercase">{profile.languages.join(', ')}</span>
      ) : (
        <span className="text-muted-foreground">не указаны</span>
      ),
    },
    { icon: CalendarDays, label: 'В эфире с', value: joined },
  ];

  return (
    <div className="space-y-5">
      {profile.status ? (
        <p className="text-pretty text-[0.9375rem] leading-relaxed text-foreground/90">{profile.status}</p>
      ) : (
        <p className="text-pretty text-sm italic text-muted-foreground">Пользователь пока не добавил описание.</p>
      )}

      {profile.interests && profile.interests.length > 0 && (
        <div className="rounded-xl bg-card/40 px-3.5 py-3 ring-1 ring-border/50">
          <p className="mb-2 flex items-center gap-2 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-4 w-4 text-[var(--color-neon-violet)]" aria-hidden="true" />
            Интересы
          </p>
          <InterestChips interests={profile.interests} />
        </div>
      )}

      <dl className="grid gap-2.5 sm:grid-cols-2">
        {rows.map(({ icon: Icon, label, value }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-xl bg-card/40 px-3.5 py-2.5 ring-1 ring-border/50"
          >
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="truncate text-sm font-medium text-foreground/90">{value}</dd>
            </div>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ── Активность ───────────────────────────────────────────────────────── */

function ActivityPanel({
  profile,
  status,
  gifts,
  isLoading,
}: {
  profile: PublicProfile;
  status?: OnlineStatus;
  gifts: ReceivedGift[];
  isLoading: boolean;
}) {
  // No dedicated activity feed yet — synthesise a light, honest timeline from
  // the signals we DO have (join date + most recent received gifts).
  const recent = [...gifts]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const online = status === 'online' || status === 'away' || status === 'in_call';

  return (
    <ol className="relative space-y-4 before:absolute before:left-[0.6875rem] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-border/60">
      {online && (
        <TimelineRow
          tone="text-success"
          dot="bg-success"
          title="Сейчас в сети"
          meta="Можно написать или позвонить"
        />
      )}

      {isLoading ? (
        <li className="ml-8 text-sm text-muted-foreground">Загрузка активности…</li>
      ) : (
        recent.map((g) => (
          <TimelineRow
            key={g.id}
            tone="text-[var(--color-neon-magenta)]"
            dot="bg-[var(--color-neon-magenta)]"
            title={`Получен подарок · ${g.gift?.title ?? 'Подарок'}`}
            meta={relativeDate(g.createdAt)}
          />
        ))
      )}

      <TimelineRow
        tone="text-[var(--color-neon-cyan)]"
        dot="bg-[var(--color-neon-cyan)]"
        title="Присоединился к ruletka.top"
        meta={new Date(profile.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
      />
    </ol>
  );
}

function TimelineRow({
  tone,
  dot,
  title,
  meta,
}: {
  tone: string;
  dot: string;
  title: string;
  meta: string;
}) {
  return (
    <li className="relative flex items-start gap-4">
      <span className={cn('relative z-10 mt-1 inline-flex h-[1.375rem] w-[1.375rem] shrink-0 items-center justify-center rounded-full bg-card ring-1 ring-border/70')}>
        <span className={cn('h-2 w-2 rounded-full', dot)} aria-hidden="true" />
      </span>
      <div className="min-w-0 pt-0.5">
        <p className={cn('text-sm font-medium', tone)}>{title}</p>
        <p className="text-xs text-muted-foreground">{meta}</p>
      </div>
    </li>
  );
}

/** "сегодня" / "вчера" / "3 дня назад" / a date for older events. */
function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} ${days < 5 ? 'дня' : 'дней'} назад`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
