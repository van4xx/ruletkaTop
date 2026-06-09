'use client';

/**
 * Find people.
 *
 * Free-text nickname search backed by the real paginated `GET /profiles/search`
 * endpoint (the same one the /search page uses). As a pure convenience, a query
 * that is itself a 24-char ObjectId is also resolved via `GET /profiles/:id`, so
 * pasting a user id always lands the right person even if it falls outside the
 * nickname-prefix window.
 *
 * Results link to the public profile and offer quick actions (add friend / gift)
 * via the modal store.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Gift, RefreshCw, Search, UserPlus, UserRound } from 'lucide-react';
import { objectIdSchema, type PublicProfile } from '@ruletka/shared-types';
import type { QueryFunctionContext } from '@tanstack/react-query';
import {
  Avatar,
  Badge,
  Button,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  IconButton,
  Input,
  Skeleton,
} from '@ruletka/ui';
import { api, ApiClientError } from '@/lib/api';
import { useModal } from '@/lib/stores/modal-store';

/**
 * Free-text people search via the real paginated `GET /profiles/search`. When
 * the query is itself an ObjectId we also resolve it directly via
 * `GET /profiles/:id` (a pure convenience) and surface that profile first.
 */
async function searchUsers(
  query: string,
  signal?: AbortSignal,
): Promise<PublicProfile[]> {
  const q = query.trim();
  if (!q) return [];

  const page = await api.profiles.search({ q }, signal);
  const items = page.items;

  if (objectIdSchema.safeParse(q).success && !items.some((p) => p.id === q)) {
    try {
      const profile = await api.profile.byId(q);
      return [profile, ...items];
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) return items;
      throw err;
    }
  }

  return items;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function SearchUsersModal() {
  const { open } = useModal();
  const t = useTranslations('chrome');
  const tc = useTranslations('common');
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term, 350);
  const isIdLike = useMemo(() => objectIdSchema.safeParse(debounced.trim()).success, [debounced]);

  const results = useQuery({
    queryKey: ['search-users', debounced.trim()],
    queryFn: ({ signal }: QueryFunctionContext) => searchUsers(debounced, signal),
    enabled: debounced.trim().length >= 2,
    staleTime: 30_000,
  });

  const items = results.data ?? [];
  const showEmpty =
    debounced.trim().length >= 2 && !results.isFetching && !results.isError && items.length === 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('modals.searchUsers.title')}</DialogTitle>
        <DialogDescription>{t('modals.searchUsers.description')}</DialogDescription>
      </DialogHeader>

      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder={t('modals.searchUsers.inputPlaceholder')}
        leadingIcon={<Search className="h-4 w-4" />}
        autoFocus
        aria-label={t('modals.searchUsers.inputAria')}
      />

      <div className="mt-4 max-h-[50vh] min-h-[8rem] space-y-2 overflow-y-auto pr-1">
        {debounced.trim().length < 2 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('modals.searchUsers.minChars')}
          </p>
        )}

        {results.isFetching &&
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}

        {results.isError && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {t('modals.searchUsers.searchError')}
            </p>
            <Button
              variant="outline"
              size="sm"
              leadingIcon={<RefreshCw className="h-4 w-4" />}
              onClick={() => results.refetch()}
            >
              {tc('retry')}
            </Button>
          </div>
        )}

        {showEmpty && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <p>{t('modals.searchUsers.emptyTitle')}</p>
            {!isIdLike && <p className="mt-1 text-xs">{t('modals.searchUsers.emptyHint')}</p>}
          </div>
        )}

        {!results.isFetching &&
          items.map((profile) => <ResultRow key={profile.id} profile={profile} onAction={open} />)}
      </div>
    </>
  );
}

function ResultRow({
  profile,
  onAction,
}: {
  profile: PublicProfile;
  onAction: ReturnType<typeof useModal>['open'];
}) {
  const { close } = useModal();
  const t = useTranslations('chrome');
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 p-2.5">
      <Avatar
        size="md"
        src={profile.avatarUrl}
        alt={profile.nickname}
        ring={profile.isPremium ? 'aurora' : 'none'}
      />
      <Link
        href={`/profile/${profile.id}`}
        onClick={close}
        className="min-w-0 flex-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium text-foreground">{profile.nickname}</span>
          {profile.isPremium && (
            <Badge variant="warning" size="sm">
              PRO
            </Badge>
          )}
        </span>
        <span className="block text-xs text-muted-foreground">
          {t('modals.searchUsers.ageCountry', { age: profile.age, country: profile.country })}
        </span>
      </Link>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton
          size="sm"
          variant="ghost"
          aria-label={t('modals.searchUsers.giftAria', { name: profile.nickname })}
          onClick={() =>
            onAction('gift-picker', {
              toUserId: profile.id,
              toNickname: profile.nickname,
              context: 'profile',
            })
          }
        >
          <Gift className="h-4 w-4" />
        </IconButton>
        <IconButton
          size="sm"
          variant="ghost"
          aria-label={t('modals.searchUsers.addFriendAria', { name: profile.nickname })}
          onClick={() =>
            onAction('add-friend', { presetUserId: profile.id, nickname: profile.nickname })
          }
        >
          <UserPlus className="h-4 w-4" />
        </IconButton>
        <Button asChild size="sm" variant="outline" leadingIcon={<UserRound className="h-4 w-4" />}>
          <Link href={`/profile/${profile.id}`} onClick={close}>
            {t('modals.searchUsers.profile')}
          </Link>
        </Button>
      </div>
    </div>
  );
}
