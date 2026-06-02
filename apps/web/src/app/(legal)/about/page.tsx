import type { Metadata } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, Globe2, Heart, Shield, Sparkles, Zap } from 'lucide-react';
import { LegalLayout, type TocEntry } from '@/components/legal/legal-layout';
import { Section, P, List } from '@/components/legal/legal-content';
import { cn } from '@/lib/cn';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal');
  return {
    title: t('about.metaTitle'),
    description: t('about.metaDescription'),
  };
}

const VALUE_KEYS = ['safety', 'respect', 'borderless', 'speed'] as const;
const VALUE_ICONS = {
  safety: Shield,
  respect: Heart,
  borderless: Globe2,
  speed: Zap,
} as const;

const STAT_KEYS = ['countries', 'connect', 'live'] as const;

export default function AboutPage() {
  const t = useTranslations('legal');

  const TOC: TocEntry[] = [
    { id: 'mission', label: t('about.toc.mission') },
    { id: 'different', label: t('about.toc.different') },
    { id: 'values', label: t('about.toc.values') },
    { id: 'numbers', label: t('about.toc.numbers') },
    { id: 'join', label: t('about.toc.join') },
  ];

  return (
    <LegalLayout
      eyebrow={
        <>
          <Sparkles className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
          {t('about.eyebrow')}
        </>
      }
      title={
        <>
          {t('about.title1')} <span className="text-gradient-neon">{t('about.title2')}</span>
        </>
      }
      lede={t('about.lede')}
      toc={TOC}
    >
      <Section id="mission" index={1} title={t('about.mission.title')}>
        <P>{t('about.mission.p1')}</P>
        <P>{t('about.mission.p2')}</P>
      </Section>

      <Section id="different" index={2} title={t('about.different.title')}>
        <List
          variant="check"
          items={[
            t('about.different.item1'),
            t('about.different.item2'),
            t('about.different.item3'),
            t('about.different.item4'),
            t('about.different.item5'),
          ]}
        />
      </Section>

      <Section id="values" index={3} title={t('about.values.title')}>
        <P>{t('about.values.intro')}</P>
        <div className="grid gap-4 sm:grid-cols-2">
          {VALUE_KEYS.map((key, i) => {
            const Icon = VALUE_ICONS[key];
            const accents = [
              'from-violet-500/25 to-fuchsia-500/5',
              'from-fuchsia-500/25 to-pink-500/5',
              'from-cyan-400/25 to-sky-500/5',
              'from-amber-400/25 to-pink-500/5',
            ];
            return (
              <div key={key} className="group relative overflow-hidden rounded-2xl">
                <div
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-0 bg-gradient-to-br opacity-60 transition-opacity duration-300 group-hover:opacity-100',
                    accents[i % accents.length],
                  )}
                />
                <div className="glass-panel relative flex h-full flex-col gap-3 rounded-2xl p-5">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-card/70 text-foreground ring-1 ring-border/70">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="font-display text-base font-bold tracking-tight text-foreground">
                    {t(`about.values.${key}.title`)}
                  </h3>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {t(`about.values.${key}.text`)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section id="numbers" index={4} title={t('about.numbers.title')}>
        <div className="glass-panel grid grid-cols-1 divide-y divide-border/60 rounded-2xl sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {STAT_KEYS.map((key) => (
            <div key={key} className="flex flex-col items-center gap-1 px-6 py-7 text-center">
              <span className="font-display text-3xl font-bold text-gradient-neon">
                {t(`about.numbers.${key}Value`)}
              </span>
              <span className="text-sm text-muted-foreground">
                {t(`about.numbers.${key}Label`)}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="join" index={5} title={t('about.join.title')}>
        <P>{t('about.join.p1')}</P>
        <div>
          <Link
            href="/video"
            className={cn(
              'group inline-flex items-center justify-center gap-2 rounded-xl px-7 py-3.5',
              'text-base font-semibold text-primary-foreground',
              'bg-gradient-to-r from-[var(--color-neon-violet)] via-[var(--color-neon-magenta)] to-[var(--color-neon-violet)] bg-[length:200%_100%] bg-left',
              'shadow-[0_8px_30px_-8px_var(--color-neon-violet)] transition-[background-position,transform] duration-500',
              'hover:bg-right hover:-translate-y-0.5 active:translate-y-0',
            )}
          >
            {t('about.join.cta')}
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </Section>
    </LegalLayout>
  );
}
