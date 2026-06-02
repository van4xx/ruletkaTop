import type { Metadata } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { ShieldCheck, Flag, Ban } from 'lucide-react';
import { LegalLayout, type TocEntry } from '@/components/legal/legal-layout';
import { Section, P, H3, List, Callout } from '@/components/legal/legal-content';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal');
  return {
    title: t('rules.metaTitle'),
    description: t('rules.metaDescription'),
  };
}

export default function RulesPage() {
  const t = useTranslations('legal');

  const TOC: TocEntry[] = [
    { id: 'age', label: t('rules.toc.age') },
    { id: 'principles', label: t('rules.toc.principles') },
    { id: 'prohibited', label: t('rules.toc.prohibited') },
    { id: 'ugc', label: t('rules.toc.ugc') },
    { id: 'reports', label: t('rules.toc.reports') },
    { id: 'consequences', label: t('rules.toc.consequences') },
  ];

  return (
    <LegalLayout
      eyebrow={
        <>
          <ShieldCheck className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
          {t('rules.eyebrow')}
        </>
      }
      title={
        <>
          {t('rules.title1')} <span className="text-gradient-neon">{t('rules.title2')}</span>
        </>
      }
      lede={t('rules.lede')}
      updatedAt={t('rules.updatedAt')}
      toc={TOC}
    >
      <Section id="age" index={1} title={t('rules.age.title')}>
        <Callout tone="warning" icon={<Ban className="h-5 w-5" />}>
          <p className="font-semibold text-foreground">{t('rules.age.calloutTitle')}</p>
          <p>{t('rules.age.calloutBody')}</p>
        </Callout>
        <P>{t('rules.age.p1')}</P>
      </Section>

      <Section id="principles" index={2} title={t('rules.principles.title')}>
        <P>{t('rules.principles.intro')}</P>
        <List
          variant="check"
          items={[
            t('rules.principles.item1'),
            t('rules.principles.item2'),
            t('rules.principles.item3'),
            t('rules.principles.item4'),
          ]}
        />
      </Section>

      <Section id="prohibited" index={3} title={t('rules.prohibited.title')}>
        <P>{t('rules.prohibited.intro')}</P>
        <List
          variant="cross"
          items={[
            t('rules.prohibited.item1'),
            t('rules.prohibited.item2'),
            t('rules.prohibited.item3'),
            t('rules.prohibited.item4'),
            t('rules.prohibited.item5'),
            t('rules.prohibited.item6'),
          ]}
        />
        <Callout>
          <p>{t('rules.prohibited.callout')}</p>
        </Callout>
      </Section>

      <Section id="ugc" index={4} title={t('rules.ugc.title')}>
        <P>{t('rules.ugc.p1')}</P>
        <H3>{t('rules.ugc.subheading')}</H3>
        <List
          variant="dot"
          items={[
            t('rules.ugc.item1'),
            t('rules.ugc.item2'),
            t('rules.ugc.item3'),
            t('rules.ugc.item4'),
          ]}
        />
      </Section>

      <Section id="reports" index={5} title={t('rules.reports.title')}>
        <P>{t('rules.reports.intro')}</P>
        <List
          variant="dot"
          items={[
            <>{t('rules.reports.item1')}</>,
            t('rules.reports.item2'),
            <>
              {t('rules.reports.item3Pre')}{' '}
              <Link href="/help" className="text-[var(--color-neon-cyan)] hover:underline">
                {t('rules.reports.item3Link')}
              </Link>
              .
            </>,
          ]}
        />
        <Callout icon={<Flag className="h-5 w-5" />}>
          <p>{t('rules.reports.callout')}</p>
        </Callout>
      </Section>

      <Section id="consequences" index={6} title={t('rules.consequences.title')}>
        <P>{t('rules.consequences.intro')}</P>
        <List
          variant="dot"
          items={[
            t('rules.consequences.item1'),
            t('rules.consequences.item2'),
            t('rules.consequences.item3'),
            t('rules.consequences.item4'),
          ]}
        />
        <P>{t('rules.consequences.outro')}</P>
      </Section>
    </LegalLayout>
  );
}
