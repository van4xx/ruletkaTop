import type { Metadata } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { LifeBuoy, Rocket, ShieldQuestion, Coins, MessageSquareWarning } from 'lucide-react';
import { LegalLayout, type TocEntry } from '@/components/legal/legal-layout';
import { Section, P, List, Callout } from '@/components/legal/legal-content';
import { FaqAccordion, type FaqItem } from '@/components/legal/faq-accordion';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal');
  return {
    title: t('help.metaTitle'),
    description: t('help.metaDescription'),
  };
}

export default function HelpPage() {
  const t = useTranslations('legal');

  const TOC: TocEntry[] = [
    { id: 'start', label: t('help.toc.start') },
    { id: 'safety', label: t('help.toc.safety') },
    { id: 'coins', label: t('help.toc.coins') },
    { id: 'faq', label: t('help.toc.faq') },
    { id: 'contact', label: t('help.toc.contact') },
  ];

  const FAQ_GENERAL: FaqItem[] = [
    { q: t('help.faqGeneral.q1'), a: t('help.faqGeneral.a1') },
    { q: t('help.faqGeneral.q2'), a: t('help.faqGeneral.a2') },
    { q: t('help.faqGeneral.q3'), a: t('help.faqGeneral.a3') },
    { q: t('help.faqGeneral.q4'), a: t('help.faqGeneral.a4') },
    { q: t('help.faqGeneral.q5'), a: t('help.faqGeneral.a5') },
    {
      q: t('help.faqGeneral.q6'),
      a: (
        <>
          {t('help.faqGeneral.a6Pre')}{' '}
          <Link href="/settings" className="text-[var(--color-neon-cyan)] hover:underline">
            {t('help.faqGeneral.a6Link')}
          </Link>{' '}
          {t('help.faqGeneral.a6Post')}
        </>
      ),
    },
  ];

  const FAQ_BILLING: FaqItem[] = [
    { q: t('help.faqBilling.q1'), a: t('help.faqBilling.a1') },
    { q: t('help.faqBilling.q2'), a: t('help.faqBilling.a2') },
    { q: t('help.faqBilling.q3'), a: t('help.faqBilling.a3') },
    {
      q: t('help.faqBilling.q4'),
      a: (
        <>
          {t('help.faqBilling.a4Pre')}{' '}
          <Link href="#contact" className="text-[var(--color-neon-cyan)] hover:underline">
            {t('help.faqBilling.a4Link')}
          </Link>
          .
        </>
      ),
    },
  ];

  return (
    <LegalLayout
      eyebrow={
        <>
          <LifeBuoy className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
          {t('help.eyebrow')}
        </>
      }
      title={
        <>
          {t('help.title1')} <span className="text-gradient-neon">{t('help.title2')}</span>
        </>
      }
      lede={t('help.lede')}
      toc={TOC}
    >
      <Section id="start" index={1} title={t('help.start.title')}>
        <P>{t('help.start.intro')}</P>
        <List
          variant="dot"
          items={[
            <>
              {t('help.start.step1Pre')}{' '}
              <Link href="/video" className="text-[var(--color-neon-cyan)] hover:underline">
                {t('help.start.step1Video')}
              </Link>{' '}
              {t('help.start.step1Or')}{' '}
              <Link href="/voice" className="text-[var(--color-neon-cyan)] hover:underline">
                {t('help.start.step1Voice')}
              </Link>
              .
            </>,
            t('help.start.step2'),
            t('help.start.step3'),
            t('help.start.step4'),
          ]}
        />
        <Callout icon={<Rocket className="h-5 w-5" />}>
          <p>{t('help.start.tip')}</p>
        </Callout>
      </Section>

      <Section id="safety" index={2} title={t('help.safety.title')}>
        <P>{t('help.safety.intro')}</P>
        <List
          variant="check"
          items={[t('help.safety.item1'), t('help.safety.item2'), t('help.safety.item3')]}
        />
        <Callout tone="warning" icon={<ShieldQuestion className="h-5 w-5" />}>
          <p>
            {t('help.safety.calloutPre')}{' '}
            <Link href="/rules" className="text-[var(--color-neon-cyan)] hover:underline">
              {t('help.safety.calloutLink')}
            </Link>
            .
          </p>
        </Callout>
      </Section>

      <Section id="coins" index={3} title={t('help.coins.title')}>
        <P>
          <span className="inline-flex items-center gap-1.5 align-middle font-medium text-foreground">
            <Coins className="h-4 w-4 text-warning" aria-hidden="true" />{' '}
            {t('help.coins.coinsLabel')}
          </span>{' '}
          {t('help.coins.bodyAfterCoins')}
        </P>
        <FaqAccordion items={FAQ_BILLING} idPrefix="faq-billing" />
      </Section>

      <Section id="faq" index={4} title={t('help.faqSection.title')}>
        <FaqAccordion items={FAQ_GENERAL} idPrefix="faq-general" />
      </Section>

      <Section id="contact" index={5} title={t('help.contact.title')}>
        <P>{t('help.contact.intro')}</P>
        <div className="glass-panel flex flex-col items-start gap-3 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <MessageSquareWarning className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-display font-semibold text-foreground">
                {t('help.contact.cardTitle')}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('help.contact.cardBodyPre')}{' '}
                <a
                  href="mailto:support@ruletka.top"
                  className="text-[var(--color-neon-cyan)] hover:underline"
                >
                  support@ruletka.top
                </a>
              </p>
            </div>
          </div>
        </div>
      </Section>
    </LegalLayout>
  );
}
