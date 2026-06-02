import type { Metadata } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { Lock, Trash2 } from 'lucide-react';
import { LegalLayout, type TocEntry } from '@/components/legal/legal-layout';
import { Section, P, List, Callout, DefinitionList } from '@/components/legal/legal-content';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal');
  return {
    title: t('privacy.metaTitle'),
    description: t('privacy.metaDescription'),
  };
}

export default function PrivacyPage() {
  const t = useTranslations('legal');

  const TOC: TocEntry[] = [
    { id: 'intro', label: t('privacy.toc.intro') },
    { id: 'data', label: t('privacy.toc.data') },
    { id: 'purposes', label: t('privacy.toc.purposes') },
    { id: 'consent', label: t('privacy.toc.consent') },
    { id: 'sharing', label: t('privacy.toc.sharing') },
    { id: 'security', label: t('privacy.toc.security') },
    { id: 'rights', label: t('privacy.toc.rights') },
    { id: 'deletion', label: t('privacy.toc.deletion') },
    { id: 'contacts', label: t('privacy.toc.contacts') },
  ];

  return (
    <LegalLayout
      eyebrow={
        <>
          <Lock className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
          {t('privacy.eyebrow')}
        </>
      }
      title={
        <>
          {t('privacy.title1')} <span className="text-gradient-neon">{t('privacy.title2')}</span>
        </>
      }
      lede={t('privacy.lede')}
      updatedAt={t('privacy.updatedAt')}
      toc={TOC}
    >
      <Section id="intro" index={1} title={t('privacy.intro.title')}>
        <P>{t('privacy.intro.p1')}</P>
        <P>{t('privacy.intro.p2')}</P>
      </Section>

      <Section id="data" index={2} title={t('privacy.data.title')}>
        <P>{t('privacy.data.intro')}</P>
        <DefinitionList
          items={[
            { term: t('privacy.data.accountTerm'), desc: t('privacy.data.accountDesc') },
            { term: t('privacy.data.profileTerm'), desc: t('privacy.data.profileDesc') },
            { term: t('privacy.data.technicalTerm'), desc: t('privacy.data.technicalDesc') },
            { term: t('privacy.data.commsTerm'), desc: t('privacy.data.commsDesc') },
            { term: t('privacy.data.paymentTerm'), desc: t('privacy.data.paymentDesc') },
          ]}
        />
      </Section>

      <Section id="purposes" index={3} title={t('privacy.purposes.title')}>
        <List
          variant="dot"
          items={[
            t('privacy.purposes.item1'),
            t('privacy.purposes.item2'),
            t('privacy.purposes.item3'),
            t('privacy.purposes.item4'),
            t('privacy.purposes.item5'),
            t('privacy.purposes.item6'),
          ]}
        />
      </Section>

      <Section id="consent" index={4} title={t('privacy.consent.title')}>
        <P>{t('privacy.consent.p1')}</P>
        <P>{t('privacy.consent.p2')}</P>
      </Section>

      <Section id="sharing" index={5} title={t('privacy.sharing.title')}>
        <P>{t('privacy.sharing.intro')}</P>
        <List
          variant="dot"
          items={[
            t('privacy.sharing.item1'),
            t('privacy.sharing.item2'),
            t('privacy.sharing.item3'),
          ]}
        />
        <P>{t('privacy.sharing.outro')}</P>
      </Section>

      <Section id="security" index={6} title={t('privacy.security.title')}>
        <P>{t('privacy.security.p1')}</P>
        <P>{t('privacy.security.p2')}</P>
      </Section>

      <Section id="rights" index={7} title={t('privacy.rights.title')}>
        <P>{t('privacy.rights.intro')}</P>
        <List
          variant="check"
          items={[
            t('privacy.rights.item1'),
            t('privacy.rights.item2'),
            t('privacy.rights.item3'),
            t('privacy.rights.item4'),
            t('privacy.rights.item5'),
          ]}
        />
      </Section>

      <Section id="deletion" index={8} title={t('privacy.deletion.title')}>
        <Callout tone="warning" icon={<Trash2 className="h-5 w-5" />}>
          <p className="font-semibold text-foreground">{t('privacy.deletion.calloutTitle')}</p>
          <p>
            {t('privacy.deletion.calloutBodyPre')}{' '}
            <Link href="/settings" className="text-[var(--color-neon-cyan)] hover:underline">
              {t('privacy.deletion.calloutLink')}
            </Link>{' '}
            {t('privacy.deletion.calloutBodyPost')}
          </p>
        </Callout>
        <P>{t('privacy.deletion.p1')}</P>
      </Section>

      <Section id="contacts" index={9} title={t('privacy.contacts.title')}>
        <P>
          {t('privacy.contacts.p1Pre')}{' '}
          <Link href="/help" className="text-[var(--color-neon-cyan)] hover:underline">
            {t('privacy.contacts.p1Link')}
          </Link>
          {t('privacy.contacts.p1Post')}
        </P>
      </Section>
    </LegalLayout>
  );
}
