'use client';

/**
 * The authenticated dashboard hub — a responsive "bento" grid composing every
 * widget. Guarded by `RequireAuth` (the page is under the protected area). The
 * grid is mobile-first single-column and resolves to a 12-column layout on
 * large screens:
 *
 *   ┌───────────── welcome ─────────────┐
 *   │ profile │      quick-launch        │   (lg: profile 4col, launch 8col)
 *   ├─────────┴──────────────┬───────────┤
 *   │        TOP feed         │  coins    │   (lg: top 8col, coins promo 4col)
 *   ├────────────┬───────────┴───────────┤
 *   │  friends   │   chats   │   notifs   │   (lg: 3 even widgets)
 *   ├────────────┴───────────────────────┤
 *   │              gifts                   │
 *   └──────────────────────────────────── ┘
 *
 * Each widget owns its own loading/empty/error state, so a slow section never
 * blocks the rest of the hub.
 */
import { motion, type Variants } from 'framer-motion';
import { RequireAuth } from '@/features/auth';
import { DashboardWelcome } from './dashboard-welcome';
import { ProfileBlock } from './profile-block';
import { QuickLaunch } from './quick-launch';
import { TopFeedWidget } from './top-feed-widget';
import { CoinsPromoWidget } from './coins-promo-widget';
import { OnlineFriendsWidget } from './online-friends-widget';
import { RecentChatsWidget } from './recent-chats-widget';
import { NotificationsWidget } from './notifications-widget';
import { GiftsWidget } from './gifts-widget';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Staggered reveal for the grid sections (one orchestrated entrance). */
const grid: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
};

const cell: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_OUT } },
};

export function DashboardClient() {
  return (
    <RequireAuth>
      <div className="grain relative overflow-hidden">
        {/* Atmospheric aurora background — consistent with the landing/economy. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-48 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--color-neon-violet)_0%,transparent_60%)] opacity-20 blur-3xl" />
          <div className="absolute -right-28 top-24 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-magenta)_0%,transparent_60%)] opacity-15 blur-3xl" />
          <div className="absolute -left-28 top-80 h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan)_0%,transparent_60%)] opacity-15 blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:64px_64px] opacity-[0.12] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        </div>

        <section className="mx-auto max-w-7xl px-4 pb-20 pt-10 sm:px-6 sm:pt-12 lg:px-8">
          <DashboardWelcome />

          <motion.div
            variants={grid}
            initial="hidden"
            animate="show"
            className="mt-8 grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-12"
          >
            {/* Hero row: profile + quick-launch. */}
            <motion.div variants={cell} className="lg:col-span-4">
              <ProfileBlock />
            </motion.div>
            <motion.div variants={cell} className="lg:col-span-8">
              {/* Quick-launch is the primary CTA — give it breathing room. */}
              <div className="flex h-full flex-col justify-center">
                <QuickLaunch />
              </div>
            </motion.div>

            {/* Signature Top feed + coins promo. */}
            <motion.div variants={cell} className="lg:col-span-8">
              <TopFeedWidget />
            </motion.div>
            <motion.div variants={cell} className="lg:col-span-4">
              <CoinsPromoWidget />
            </motion.div>

            {/* Secondary widgets. */}
            <motion.div variants={cell} className="lg:col-span-4">
              <OnlineFriendsWidget />
            </motion.div>
            <motion.div variants={cell} className="lg:col-span-4">
              <RecentChatsWidget />
            </motion.div>
            <motion.div variants={cell} className="lg:col-span-4">
              <NotificationsWidget />
            </motion.div>

            {/* Gifts showcase — full width footer. */}
            <motion.div variants={cell} className="lg:col-span-12">
              <GiftsWidget />
            </motion.div>
          </motion.div>
        </section>
      </div>
    </RequireAuth>
  );
}
