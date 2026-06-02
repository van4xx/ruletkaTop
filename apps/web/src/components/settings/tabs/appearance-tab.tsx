'use client';

/**
 * Appearance tab — color theme (light / dark / system via next-themes) and
 * interface locale (ru / en). Theme changes apply instantly through next-themes
 * AND persist to the settings document so the preference syncs across devices.
 * Locale persists to settings; the actual i18n switch is owned by the app shell.
 */
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react';
import type { Locale, Settings, Theme } from '@ruletka/shared-types';
import { Button, toast } from '@ruletka/ui';
import { LOCALE_OPTIONS } from '@/features/auth/schemas';
import { useUpdateSettings } from '@/features/settings/use-settings';
import { SettingRow, SettingsSection } from '../primitives';
import { cn } from '@/lib/cn';

const THEME_CHOICES: ReadonlyArray<{
  value: Theme;
  labelKey: string;
  icon: typeof Sun;
  preview: string;
}> = [
  {
    value: 'light',
    labelKey: 'appearance.themeLight',
    icon: Sun,
    preview: 'from-zinc-100 to-white',
  },
  {
    value: 'dark',
    labelKey: 'appearance.themeDark',
    icon: Moon,
    preview: 'from-[#0a0a0f] to-[#171622]',
  },
  {
    value: 'system',
    labelKey: 'appearance.themeSystem',
    icon: Monitor,
    preview: 'from-zinc-100 via-[#171622] to-[#0a0a0f]',
  },
];

export function AppearanceTab({ settings }: { settings: Settings }) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const { theme, setTheme } = useTheme();
  const update = useUpdateSettings();
  const [mounted, setMounted] = useState(false);
  const [locale, setLocale] = useState<Locale>(settings.locale);

  useEffect(() => setMounted(true), []);
  useEffect(() => setLocale(settings.locale), [settings.locale]);

  const current = (theme as Theme | undefined) ?? settings.theme;

  const chooseTheme = (next: Theme) => {
    setTheme(next); // instant, via next-themes
    update.mutate(
      { theme: next },
      { onError: (e) => toast.error(t('appearance.themeSaveError'), { description: e.message }) },
    );
  };

  const localeDirty = locale !== settings.locale;
  const saveLocale = () => {
    update.mutate(
      { locale },
      {
        onSuccess: () => toast.success(t('appearance.localeSaved')),
        onError: (e) => toast.error(t('appearance.localeSaveError'), { description: e.message }),
      },
    );
  };

  return (
    <SettingsSection
      title={t('appearance.title')}
      description={t('appearance.description')}
      icon={<Palette />}
    >
      <div className="space-y-7">
        <fieldset>
          <legend className="mb-3 text-sm font-medium text-foreground">
            {t('appearance.themeHeading')}
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {THEME_CHOICES.map(({ value, labelKey, icon: Icon, preview }) => {
              const selected = mounted && current === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => chooseTheme(value)}
                  className={cn(
                    'group relative overflow-hidden rounded-2xl border p-3 text-left transition-all duration-200',
                    selected
                      ? 'border-[var(--color-neon-violet)] ring-2 ring-[var(--color-neon-violet)]/40'
                      : 'border-border hover:border-border hover:-translate-y-0.5',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mb-3 block h-16 w-full rounded-lg bg-gradient-to-br ring-1 ring-inset ring-white/10',
                      preview,
                    )}
                  />
                  <span className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 text-sm font-medium">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {t(labelKey)}
                    </span>
                    {selected && (
                      <Check
                        className="h-4 w-4 text-[var(--color-neon-violet)]"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <hr className="border-border/50" />

        <SettingRow
          label={t('appearance.localeLabel')}
          description={t('appearance.localeDescription')}
          control={
            <div className="flex items-center gap-2">
              <div className="glass-panel inline-flex gap-1 rounded-xl p-1">
                {LOCALE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={locale === o.value}
                    onClick={() => setLocale(o.value)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                      locale === o.value
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {localeDirty && (
                <Button size="sm" variant="primary" loading={update.isPending} onClick={saveLocale}>
                  {tc('save')}
                </Button>
              )}
            </div>
          }
        />
      </div>
    </SettingsSection>
  );
}
