'use client';

/**
 * SINGLE SOURCE OF TRUTH for the four legal/info documents — О проекте,
 * Правила сообщества, Политика конфиденциальности, Помощь и поддержка.
 *
 * Each document's header metadata (eyebrow icon, gradient title, lede, optional
 * "last updated", and its table-of-contents) plus its long-form `Body` (the
 * exact `<Section>` prose) live here ONCE. Two surfaces render them:
 *
 *   1. the standalone `(legal)` pages (`/about`, `/rules`, `/privacy`, `/help`),
 *      which wrap a single document in {@link LegalLayout}; and
 *   2. the `/documents` "book" hub, which presents all four together with a
 *      shared spine + reading pane.
 *
 * Keeping the bodies here means the copy is never duplicated — both surfaces
 * stay perfectly in sync. All strings come from the `legal` next-intl namespace.
 */
import type { ComponentType, ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  Ban,
  Coins,
  Flag,
  Globe2,
  Heart,
  LifeBuoy,
  Lock,
  type LucideIcon,
  MessageSquareWarning,
  Rocket,
  Shield,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { ROUTES } from '@/config/nav';
import { cn } from '@/lib/cn';
import { LegalLayout, type TocEntry } from './legal-layout';
import { Section, P, H3, List, Callout, DefinitionList } from './legal-content';
import { FaqAccordion, type FaqItem } from './faq-accordion';

/** A `legal` namespace translator (`useTranslations('legal')`). */
type T = ReturnType<typeof useTranslations<'legal'>>;

/** Header chrome + body for a single document, derived from the `legal` ns. */
export interface DocDescriptor {
  /** Stable key — also the `/documents?doc=` query value and the route slug. */
  id: 'about' | 'rules' | 'privacy' | 'help';
  /** Destination of the standalone page (used by the footer/hub deep links). */
  href: string;
  /** Spine icon. */
  icon: LucideIcon;
  /** Short label for the spine / footer. */
  label: (t: T) => string;
  /** One-line teaser shown under the label in the spine. */
  tagline: (t: T) => string;
  /** The eyebrow chip contents (icon + label). */
  eyebrow: (t: T) => ReactNode;
  /** The gradient hero title (already split into plain + neon spans). */
  title: (t: T) => ReactNode;
  lede: (t: T) => string;
  /** Optional "last updated" display string. */
  updatedAt?: (t: T) => string;
  /** The table of contents for the document's sections. */
  toc: (t: T) => TocEntry[];
  /** The long-form body (the `<Section>` prose). */
  Body: ComponentType;
}

const VALUE_KEYS = ['safety', 'respect', 'borderless', 'speed'] as const;
const VALUE_ICONS = {
  safety: Shield,
  respect: Heart,
  borderless: Globe2,
  speed: Zap,
} as const;
const STAT_KEYS = ['countries', 'connect', 'live'] as const;

function AboutBody() {
  const t = useTranslations('legal');
  return (
    <>
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
            href={ROUTES.video}
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
    </>
  );
}

function RulesBody() {
  const t = useTranslations('legal');
  return (
    <>
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
              <Link href={ROUTES.help} className="text-[var(--color-neon-cyan)] hover:underline">
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
    </>
  );
}

function PrivacyBody() {
  const t = useTranslations('legal');
  return (
    <>
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
            <Link href={ROUTES.settings} className="text-[var(--color-neon-cyan)] hover:underline">
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
          <Link href={ROUTES.help} className="text-[var(--color-neon-cyan)] hover:underline">
            {t('privacy.contacts.p1Link')}
          </Link>
          {t('privacy.contacts.p1Post')}
        </P>
      </Section>
    </>
  );
}

function HelpBody() {
  const t = useTranslations('legal');

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
          <Link href={ROUTES.settings} className="text-[var(--color-neon-cyan)] hover:underline">
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
    <>
      <Section id="start" index={1} title={t('help.start.title')}>
        <P>{t('help.start.intro')}</P>
        <List
          variant="dot"
          items={[
            <>
              {t('help.start.step1Pre')}{' '}
              <Link href={ROUTES.video} className="text-[var(--color-neon-cyan)] hover:underline">
                {t('help.start.step1Video')}
              </Link>{' '}
              {t('help.start.step1Or')}{' '}
              <Link href={ROUTES.voice} className="text-[var(--color-neon-cyan)] hover:underline">
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
            <Link href={ROUTES.rules} className="text-[var(--color-neon-cyan)] hover:underline">
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
    </>
  );
}

/** The four documents, in reading order, as a "book". */
export const DOCUMENTS: readonly DocDescriptor[] = [
  {
    id: 'about',
    href: ROUTES.about,
    icon: Sparkles,
    label: (t) => t('about.docLabel'),
    tagline: (t) => t('about.docTagline'),
    eyebrow: (t) => (
      <>
        <Sparkles className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
        {t('about.eyebrow')}
      </>
    ),
    title: (t) => (
      <>
        {t('about.title1')} <span className="text-gradient-neon">{t('about.title2')}</span>
      </>
    ),
    lede: (t) => t('about.lede'),
    toc: (t) => [
      { id: 'mission', label: t('about.toc.mission') },
      { id: 'different', label: t('about.toc.different') },
      { id: 'values', label: t('about.toc.values') },
      { id: 'numbers', label: t('about.toc.numbers') },
      { id: 'join', label: t('about.toc.join') },
    ],
    Body: AboutBody,
  },
  {
    id: 'rules',
    href: ROUTES.rules,
    icon: ShieldCheck,
    label: (t) => t('rules.docLabel'),
    tagline: (t) => t('rules.docTagline'),
    eyebrow: (t) => (
      <>
        <ShieldCheck className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
        {t('rules.eyebrow')}
      </>
    ),
    title: (t) => (
      <>
        {t('rules.title1')} <span className="text-gradient-neon">{t('rules.title2')}</span>
      </>
    ),
    lede: (t) => t('rules.lede'),
    updatedAt: (t) => t('rules.updatedAt'),
    toc: (t) => [
      { id: 'age', label: t('rules.toc.age') },
      { id: 'principles', label: t('rules.toc.principles') },
      { id: 'prohibited', label: t('rules.toc.prohibited') },
      { id: 'ugc', label: t('rules.toc.ugc') },
      { id: 'reports', label: t('rules.toc.reports') },
      { id: 'consequences', label: t('rules.toc.consequences') },
    ],
    Body: RulesBody,
  },
  {
    id: 'privacy',
    href: ROUTES.privacy,
    icon: Lock,
    label: (t) => t('privacy.docLabel'),
    tagline: (t) => t('privacy.docTagline'),
    eyebrow: (t) => (
      <>
        <Lock className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
        {t('privacy.eyebrow')}
      </>
    ),
    title: (t) => (
      <>
        {t('privacy.title1')} <span className="text-gradient-neon">{t('privacy.title2')}</span>
      </>
    ),
    lede: (t) => t('privacy.lede'),
    updatedAt: (t) => t('privacy.updatedAt'),
    toc: (t) => [
      { id: 'intro', label: t('privacy.toc.intro') },
      { id: 'data', label: t('privacy.toc.data') },
      { id: 'purposes', label: t('privacy.toc.purposes') },
      { id: 'consent', label: t('privacy.toc.consent') },
      { id: 'sharing', label: t('privacy.toc.sharing') },
      { id: 'security', label: t('privacy.toc.security') },
      { id: 'rights', label: t('privacy.toc.rights') },
      { id: 'deletion', label: t('privacy.toc.deletion') },
      { id: 'contacts', label: t('privacy.toc.contacts') },
    ],
    Body: PrivacyBody,
  },
  {
    id: 'help',
    href: ROUTES.help,
    icon: LifeBuoy,
    label: (t) => t('help.docLabel'),
    tagline: (t) => t('help.docTagline'),
    eyebrow: (t) => (
      <>
        <LifeBuoy className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
        {t('help.eyebrow')}
      </>
    ),
    title: (t) => (
      <>
        {t('help.title1')} <span className="text-gradient-neon">{t('help.title2')}</span>
      </>
    ),
    lede: (t) => t('help.lede'),
    toc: (t) => [
      { id: 'start', label: t('help.toc.start') },
      { id: 'safety', label: t('help.toc.safety') },
      { id: 'coins', label: t('help.toc.coins') },
      { id: 'faq', label: t('help.toc.faq') },
      { id: 'contact', label: t('help.toc.contact') },
    ],
    Body: HelpBody,
  },
] as const;

/** Look up a single document by its id. */
function getDocument(id: DocDescriptor['id']): DocDescriptor {
  const doc = DOCUMENTS.find((d) => d.id === id);
  if (!doc) throw new Error(`Unknown document: ${id}`);
  return doc;
}

/**
 * Renders ONE document as a standalone page inside the shared {@link
 * LegalLayout} (hero + sticky TOC + prose). The `/about`, `/rules`, `/privacy`
 * and `/help` server pages render this with their id — keeping `generateMetadata`
 * server-side while the (client-only) layout + body composition lives here.
 */
export function LegalDocPage({ id }: { id: DocDescriptor['id'] }) {
  const t = useTranslations('legal');
  const doc = getDocument(id);
  const { Body } = doc;

  return (
    <LegalLayout
      eyebrow={doc.eyebrow(t)}
      title={doc.title(t)}
      lede={doc.lede(t)}
      updatedAt={doc.updatedAt?.(t)}
      toc={doc.toc(t)}
    >
      <Body />
    </LegalLayout>
  );
}
