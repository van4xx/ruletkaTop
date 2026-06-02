import type { Metadata } from 'next';
import Link from 'next/link';
import { LifeBuoy, Rocket, ShieldQuestion, Coins, MessageSquareWarning } from 'lucide-react';
import { LegalLayout, type TocEntry } from '@/components/legal/legal-layout';
import { Section, P, List, Callout } from '@/components/legal/legal-content';
import { FaqAccordion, type FaqItem } from '@/components/legal/faq-accordion';

export const metadata: Metadata = {
  title: 'Помощь и FAQ',
  description:
    'Центр помощи ruletka.top: как начать общение, безопасность, монеты и премиум, ответы на частые вопросы.',
};

const TOC: TocEntry[] = [
  { id: 'start', label: 'Как начать' },
  { id: 'safety', label: 'Безопасность' },
  { id: 'coins', label: 'Монеты и премиум' },
  { id: 'faq', label: 'Частые вопросы' },
  { id: 'contact', label: 'Связаться с нами' },
];

const FAQ_GENERAL: FaqItem[] = [
  {
    q: 'Нужно ли регистрироваться, чтобы начать?',
    a: (
      <>
        Чтобы открыть рулетку и осмотреться — нет. Но для доступа к друзьям, чатам, подаркам и
        сохранению истории нужен аккаунт. Регистрация занимает меньше минуты.
      </>
    ),
  },
  {
    q: 'Почему не находится собеседник?',
    a: 'Обычно соединение занимает меньше секунды. Если поиск затянулся — проверьте подключение к интернету и разрешение на доступ к камере и микрофону, затем попробуйте снова. В тихие часы людей в эфире может быть меньше.',
  },
  {
    q: 'Камера или микрофон не работают — что делать?',
    a: 'Убедитесь, что браузер получил разрешение на доступ к устройствам (значок камеры в адресной строке), что они не заняты другим приложением, и при необходимости выберите нужное устройство в настройках звонка.',
  },
  {
    q: 'Как пожаловаться на собеседника?',
    a: 'Во время звонка и в чате есть кнопка «Пожаловаться». Опишите, что произошло — это поможет модераторам разобраться быстрее. Вы также можете завершить звонок и заблокировать пользователя.',
  },
  {
    q: 'Сохраняются ли видеозвонки?',
    a: 'Видеопоток передаётся напрямую между собеседниками и не записывается сервисом. Текстовые сообщения в личных чатах сохраняются, чтобы вы могли вернуться к переписке.',
  },
  {
    q: 'Как удалить аккаунт?',
    a: (
      <>
        Откройте{' '}
        <Link href="/settings" className="text-[var(--color-neon-cyan)] hover:underline">
          настройки
        </Link>{' '}
        и выберите удаление аккаунта. После подтверждения профиль и связанные данные удаляются
        безвозвратно.
      </>
    ),
  },
];

const FAQ_BILLING: FaqItem[] = [
  {
    q: 'Что такое монеты и зачем они нужны?',
    a: 'Монеты — внутренняя валюта. Ими можно дарить анимированные подарки во время звонков и в чатах, а также покупать место в Топе эфира.',
  },
  {
    q: 'Безопасны ли платежи?',
    a: 'Да. Оплата проходит через защищённого платёжного провайдера, реквизиты карты не хранятся на нашей стороне.',
  },
  {
    q: 'Что даёт премиум?',
    a: 'Премиум открывает фильтры по полу и стране, убирает рекламу и повышает приоритет в поиске собеседников. Подписку можно отменить в любой момент.',
  },
  {
    q: 'Можно ли вернуть деньги?',
    a: (
      <>
        Возврат рассматривается в соответствии с законодательством и условиями оферты. Если средства
        списались ошибочно — напишите нам через{' '}
        <Link href="#contact" className="text-[var(--color-neon-cyan)] hover:underline">
          форму обращения
        </Link>
        .
      </>
    ),
  },
];

export default function HelpPage() {
  return (
    <LegalLayout
      eyebrow={
        <>
          <LifeBuoy className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
          Поддержка
        </>
      }
      title={
        <>
          Помощь и <span className="text-gradient-neon">ответы</span>
        </>
      }
      lede="Всё, что нужно знать для уверенного старта, безопасного общения и работы с монетами. Не нашли ответ — напишите нам."
      toc={TOC}
    >
      <Section id="start" index={1} title="Как начать">
        <P>Запустить общение можно буквально в один клик:</P>
        <List
          variant="dot"
          items={[
            <>
              Откройте{' '}
              <Link href="/video" className="text-[var(--color-neon-cyan)] hover:underline">
                видеорулетку
              </Link>{' '}
              или{' '}
              <Link href="/voice" className="text-[var(--color-neon-cyan)] hover:underline">
                голосовую рулетку
              </Link>
              .
            </>,
            'Разрешите доступ к камере и микрофону, когда браузер попросит.',
            'Нажмите «Начать» — мы подберём случайного собеседника за доли секунды.',
            'Понравился человек? Добавьте его в друзья и продолжайте общение в чатах.',
          ]}
        />
        <Callout icon={<Rocket className="h-5 w-5" />}>
          <p>
            Совет: заполните профиль и пройдите быстрый онбординг — так собеседникам будет интереснее,
            а подбор точнее.
          </p>
        </Callout>
      </Section>

      <Section id="safety" index={2} title="Безопасность и комфорт">
        <P>
          Мы хотим, чтобы общение оставалось приятным. Несколько простых правил помогут вам
          чувствовать себя в безопасности:
        </P>
        <List
          variant="check"
          items={[
            'Не делитесь личными данными (адрес, телефон, реквизиты) со случайными собеседниками.',
            'Используйте жалобу и блокировку, если поведение собеседника вам неприятно.',
            'Помните о возрастном ограничении 18+ и нормах сообщества.',
          ]}
        />
        <Callout tone="warning" icon={<ShieldQuestion className="h-5 w-5" />}>
          <p>
            Подробнее о допустимом поведении — в{' '}
            <Link href="/rules" className="text-[var(--color-neon-cyan)] hover:underline">
              Правилах сообщества
            </Link>
            .
          </p>
        </Callout>
      </Section>

      <Section id="coins" index={3} title="Монеты и премиум">
        <P>
          <span className="inline-flex items-center gap-1.5 align-middle font-medium text-foreground">
            <Coins className="h-4 w-4 text-warning" aria-hidden="true" /> Монеты
          </span>{' '}
          — это валюта подарков и Топа. Премиум добавляет фильтры и приоритет в поиске. Управлять
          балансом и подпиской можно в соответствующих разделах.
        </P>
        <FaqAccordion items={FAQ_BILLING} idPrefix="faq-billing" />
      </Section>

      <Section id="faq" index={4} title="Частые вопросы">
        <FaqAccordion items={FAQ_GENERAL} idPrefix="faq-general" />
      </Section>

      <Section id="contact" index={5} title="Связаться с нами">
        <P>
          Не нашли ответ или столкнулись с проблемой? Опишите ситуацию — и мы поможем. По вопросам
          безопасности и модерации мы отвечаем в приоритетном порядке.
        </P>
        <div className="glass-panel flex flex-col items-start gap-3 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <MessageSquareWarning className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-display font-semibold text-foreground">Поддержка ruletka.top</p>
              <p className="text-sm text-muted-foreground">
                Напишите нам на{' '}
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
