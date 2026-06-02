import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { MessagesSquare } from 'lucide-react';
import { ChatsClient } from '@/features/chat/chats-client';
import { ConversationsSkeleton } from '@/components/chat/chat-skeleton';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('social');
  return {
    title: t('chatsMetaTitle'),
    description: t('chatsMetaDescription'),
  };
}

/**
 * /chats — the conversation inbox. The interactive list reads `?to=` from the
 * URL (deep-link to a user), so it lives inside a Suspense boundary as required
 * by Next.js for `useSearchParams`.
 */
export default function ChatsPage() {
  const t = useTranslations('social');
  return (
    <div className="relative overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 right-1/4 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan)_0%,transparent_60%)] opacity-[0.16] blur-3xl" />
        <div className="absolute -left-20 top-24 h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-violet)_0%,transparent_60%)] opacity-[0.14] blur-3xl" />
      </div>

      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
        <header className="mb-8 flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-card/70 text-[var(--color-neon-cyan)] ring-1 ring-border/70">
            <MessagesSquare className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
              {t('chatsHeading')}
            </h1>
            <p className="text-sm text-muted-foreground">{t('chatsSubtitle')}</p>
          </div>
        </header>

        <Suspense fallback={<ConversationsSkeleton />}>
          <ChatsClient />
        </Suspense>
      </div>
    </div>
  );
}
