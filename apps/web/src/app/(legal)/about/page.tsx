import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Globe2, Heart, Shield, Sparkles, Zap } from 'lucide-react';
import { LegalLayout, type TocEntry } from '@/components/legal/legal-layout';
import { Section, P, List } from '@/components/legal/legal-content';
import { cn } from '@/lib/cn';

export const metadata: Metadata = {
  title: 'О проекте',
  description:
    'О проекте ruletka.top — видео- и голосовая рулетка нового поколения. Наша миссия, ценности и чем мы отличаемся.',
};

const TOC: TocEntry[] = [
  { id: 'mission', label: 'Миссия' },
  { id: 'different', label: 'Чем мы отличаемся' },
  { id: 'values', label: 'Наши ценности' },
  { id: 'numbers', label: 'В цифрах' },
  { id: 'join', label: 'Присоединяйтесь' },
];

const VALUES = [
  {
    icon: Shield,
    title: 'Безопасность',
    text: 'Модерация, жалобы и блокировки, строгое ограничение 18+ — комфорт и защита превыше всего.',
  },
  {
    icon: Heart,
    title: 'Уважение',
    text: 'Мы строим культуру доброжелательного общения, где ценят границы каждого.',
  },
  {
    icon: Globe2,
    title: 'Без границ',
    text: 'Люди из 120+ стран в одном эфире. Общение объединяет, где бы вы ни были.',
  },
  {
    icon: Zap,
    title: 'Скорость',
    text: 'Соединение меньше чем за секунду. Никаких очередей и ожидания — только живое общение.',
  },
] as const;

const STATS = [
  { value: '120+', label: 'стран в эфире' },
  { value: '<1 сек', label: 'до соединения' },
  { value: '24/7', label: 'живой эфир' },
] as const;

export default function AboutPage() {
  return (
    <LegalLayout
      eyebrow={
        <>
          <Sparkles className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
          О проекте
        </>
      }
      title={
        <>
          Встреча с миром <span className="text-gradient-neon">в одном клике</span>
        </>
      }
      lede="ruletka.top — это видео- и голосовая рулетка нового поколения. Мы создаём пространство для лёгких, живых и безопасных знакомств со всего мира."
      toc={TOC}
    >
      <Section id="mission" index={1} title="Наша миссия">
        <P>
          Мир стал ближе, но настоящих, спонтанных встреч стало меньше. Мы возвращаем ощущение
          случайного, тёплого знакомства — когда за одну секунду перед вами оказывается новый человек,
          с которым можно поговорить о чём угодно.
        </P>
        <P>
          Наша цель — сделать такое общение мгновенным, увлекательным и, главное, безопасным для
          каждого участника.
        </P>
      </Section>

      <Section id="different" index={2} title="Чем мы отличаемся">
        <List
          variant="check"
          items={[
            'Мгновенный коннект — соединение со случайным собеседником меньше чем за секунду.',
            'Видео и голос — общайтесь с камерой или без неё, как комфортнее именно вам.',
            'Живая экономика — дарите анимированные подарки и попадайте в Топ эфира.',
            'Друзья и чаты — сохраняйте понравившиеся знакомства и продолжайте общение.',
            'Честная модерация — инструменты жалоб и блокировок работают на вашей стороне.',
          ]}
        />
      </Section>

      <Section id="values" index={3} title="Наши ценности">
        <P>Всё, что мы делаем, опирается на четыре принципа:</P>
        <div className="grid gap-4 sm:grid-cols-2">
          {VALUES.map((v, i) => {
            const Icon = v.icon;
            const accents = [
              'from-violet-500/25 to-fuchsia-500/5',
              'from-fuchsia-500/25 to-pink-500/5',
              'from-cyan-400/25 to-sky-500/5',
              'from-amber-400/25 to-pink-500/5',
            ];
            return (
              <div key={v.title} className="group relative overflow-hidden rounded-2xl">
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
                    {v.title}
                  </h3>
                  <p className="text-sm leading-6 text-muted-foreground">{v.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section id="numbers" index={4} title="В цифрах">
        <div className="glass-panel grid grid-cols-1 divide-y divide-border/60 rounded-2xl sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {STATS.map((stat) => (
            <div key={stat.label} className="flex flex-col items-center gap-1 px-6 py-7 text-center">
              <span className="font-display text-3xl font-bold text-gradient-neon">{stat.value}</span>
              <span className="text-sm text-muted-foreground">{stat.label}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="join" index={5} title="Присоединяйтесь">
        <P>
          Готовы познакомиться с кем-то новым? Эфир уже идёт — и для старта не нужно ничего, кроме
          желания общаться.
        </P>
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
            Начать общение
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </Section>
    </LegalLayout>
  );
}
