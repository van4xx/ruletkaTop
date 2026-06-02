'use client';

/**
 * The settings cockpit — a responsive tabbed layout.
 *
 * Desktop (lg+): a sticky left rail of tabs beside the active panel.
 * Mobile: a horizontally scrollable tab strip above the panel.
 *
 * Tabs that need the settings document (Privacy / Notifications / Appearance /
 * Devices) wait on the shared `useSettings` query and show skeletons / an error
 * retry until it resolves; Account, Blocklist and Danger fetch their own data.
 * The active tab is reflected in the URL hash so it survives reloads + sharing.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Ban,
  Bell,
  MonitorSmartphone,
  Palette,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { Button, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@ruletka/ui';
import { useSettings } from '@/features/settings/use-settings';
import { cn } from '@/lib/cn';
import { AccountTab } from './tabs/account-tab';
import { PrivacyTab } from './tabs/privacy-tab';
import { NotificationsTab } from './tabs/notifications-tab';
import { DevicesTab } from './tabs/devices-tab';
import { AppearanceTab } from './tabs/appearance-tab';
import { BlocklistTab } from './tabs/blocklist-tab';
import { DangerTab } from './tabs/danger-tab';

const TABS = [
  { value: 'account', label: 'Аккаунт', icon: UserRound },
  { value: 'privacy', label: 'Приватность', icon: ShieldCheck },
  { value: 'notifications', label: 'Уведомления', icon: Bell },
  { value: 'devices', label: 'Устройства', icon: MonitorSmartphone },
  { value: 'appearance', label: 'Оформление', icon: Palette },
  { value: 'blocklist', label: 'Чёрный список', icon: Ban },
  { value: 'danger', label: 'Опасная зона', icon: TriangleAlert },
] as const;

type TabValue = (typeof TABS)[number]['value'];
const TAB_VALUES = TABS.map((t) => t.value) as readonly string[];

function SettingsSkeleton() {
  return (
    <div className="glass-panel space-y-5 rounded-2xl p-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-xl" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-2/3" />
    </div>
  );
}

export function SettingsView() {
  const settingsQuery = useSettings();
  const [active, setActive] = useState<TabValue>('account');

  // Sync the active tab with the URL hash (deep-link + reload friendly).
  useEffect(() => {
    const fromHash = window.location.hash.replace('#', '');
    if (fromHash && TAB_VALUES.includes(fromHash)) {
      setActive(fromHash as TabValue);
    }
  }, []);

  const onTabChange = (value: string) => {
    setActive(value as TabValue);
    if (typeof window !== 'undefined') {
      history.replaceState(null, '', `#${value}`);
    }
  };

  /** Renders a settings-dependent tab body with loading/error fallbacks. */
  const withSettings = (render: (s: NonNullable<typeof settingsQuery.data>) => React.ReactNode) => {
    if (settingsQuery.isLoading) return <SettingsSkeleton />;
    if (settingsQuery.isError || !settingsQuery.data) {
      return (
        <div className="glass-panel flex flex-col items-center gap-3 rounded-2xl py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {settingsQuery.error?.message ?? 'Не удалось загрузить настройки.'}
          </p>
          <Button variant="secondary" size="sm" onClick={() => settingsQuery.refetch()}>
            Повторить
          </Button>
        </div>
      );
    }
    return render(settingsQuery.data);
  };

  return (
    <Tabs value={active} onValueChange={onTabChange} className="lg:grid lg:grid-cols-[15rem_1fr] lg:gap-8">
      {/* Tab navigation. On lg+, a sticky vertical rail; on mobile, a scroll strip. */}
      <div className="lg:sticky lg:top-20 lg:self-start">
        <TabsList
          className={cn(
            'mb-6 flex w-full gap-1 overflow-x-auto rounded-xl p-1 lg:mb-0 lg:flex-col lg:overflow-visible',
            // hide scrollbar on mobile strip
            '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          )}
        >
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              className={cn(
                'shrink-0 justify-start gap-2.5 whitespace-nowrap rounded-lg px-3.5 py-2.5 text-sm',
                'data-[state=active]:bg-gradient-to-r data-[state=active]:from-[var(--color-neon-violet)]/90 data-[state=active]:to-[var(--color-neon-magenta)]/90',
                'data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_6px_20px_-10px_var(--color-neon-violet)]',
                'lg:w-full',
                value === 'danger' && 'data-[state=active]:from-destructive data-[state=active]:to-destructive/80',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {/* Active panel, with a subtle cross-fade on change. */}
      <motion.div
        key={active}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="min-w-0"
      >
        <TabsContent value="account" className="mt-0">
          <AccountTab />
        </TabsContent>
        <TabsContent value="privacy" className="mt-0">
          {withSettings((s) => (
            <PrivacyTab settings={s} />
          ))}
        </TabsContent>
        <TabsContent value="notifications" className="mt-0">
          {withSettings((s) => (
            <NotificationsTab settings={s} />
          ))}
        </TabsContent>
        <TabsContent value="devices" className="mt-0">
          {withSettings((s) => (
            <DevicesTab settings={s} />
          ))}
        </TabsContent>
        <TabsContent value="appearance" className="mt-0">
          {withSettings((s) => (
            <AppearanceTab settings={s} />
          ))}
        </TabsContent>
        <TabsContent value="blocklist" className="mt-0">
          <BlocklistTab />
        </TabsContent>
        <TabsContent value="danger" className="mt-0">
          <DangerTab />
        </TabsContent>
      </motion.div>
    </Tabs>
  );
}
