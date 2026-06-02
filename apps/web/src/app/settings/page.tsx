'use client';

/**
 * /settings — the user's settings cockpit (Account, Privacy, Notifications,
 * Devices, Appearance, Blocklist, Danger).
 *
 * `RequireAuth` is the client-side complement to `src/middleware.ts`: the edge
 * middleware blocks unauthenticated requests up-front; this also bounces a
 * session that expires mid-visit without a hard reload.
 */
import { Settings as SettingsIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import { RequireAuth } from '@/features/auth/require-auth';
import { SettingsView } from '@/components/settings/settings-view';

export default function SettingsPage() {
  return (
    <RequireAuth>
      <div className="grain relative min-h-[calc(100dvh-4rem)] overflow-hidden">
        {/* Soft atmospheric glow, kept subtle for a utility surface. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-32 right-0 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-violet)_0%,transparent_60%)] opacity-[0.12] blur-3xl" />
          <div className="absolute bottom-0 left-1/4 h-[20rem] w-[20rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan)_0%,transparent_60%)] opacity-[0.1] blur-3xl" />
        </div>

        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
          <motion.header
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="mb-8"
          >
            <span className="inline-flex items-center gap-2 rounded-full glass-panel px-3 py-1 text-xs font-medium text-muted-foreground">
              <SettingsIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Настройки
            </span>
            <h1 className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Управление аккаунтом
            </h1>
            <p className="mt-2 max-w-xl text-muted-foreground">
              Профиль, приватность, уведомления и устройства — всё в одном месте.
            </p>
          </motion.header>

          <SettingsView />
        </div>
      </div>
    </RequireAuth>
  );
}
