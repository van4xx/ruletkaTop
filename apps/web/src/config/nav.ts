/**
 * Canonical navigation registry for ruletka.top.
 *
 * SINGLE SOURCE OF TRUTH for the app's routes and the structure of the header,
 * the avatar dropdown, the mobile drawer and the ⌘K command palette. Feature
 * agents that own individual pages (`/video`, `/friends`, …) should import
 * {@link ROUTES} / the nav collections from here rather than hard-coding paths,
 * so links stay consistent across the product.
 *
 * Header taxonomy (intentional, owner's brief — keep it minimal):
 *   • {@link PRIMARY_NAV} — the few core actions shown in the desktop bar.
 *   • {@link USER_MENU}   — secondary destinations tucked into the avatar menu.
 *   • {@link MOBILE_NAV}  — the fuller set surfaced in the mobile drawer.
 *   • {@link COMMAND_ITEMS} — everything reachable, for the ⌘K palette.
 *
 * {@link NAV_ITEMS} is kept as the union of primary + secondary so existing
 * consumers (e.g. the site footer) keep listing every section.
 */
import type { LucideIcon } from 'lucide-react';
import {
  Compass,
  CreditCard,
  Gift,
  LayoutDashboard,
  MessagesSquare,
  Mic,
  Settings,
  Sparkles,
  Trophy,
  UserRound,
  Users,
  Video,
} from 'lucide-react';

/** Strongly-typed map of every primary route in the app. */
export const ROUTES = {
  home: '/',
  /** Authenticated hub — logged-in users land here. */
  dashboard: '/dashboard',
  video: '/video',
  voice: '/voice',
  friends: '/friends',
  /** Incoming/outgoing friend requests. */
  friendRequests: '/friends/requests',
  chats: '/chats',
  top: '/top',
  /** Current user's own profile. */
  me: '/profile/me',

  // ── Secondary / utility destinations (not in the primary nav). ──
  notifications: '/notifications',
  search: '/search',
  settings: '/settings',
  wallet: '/wallet',
  gifts: '/gifts',
  premium: '/premium',
  /** Where the coin-balance "+" sends the user to top up. */
  coins: '/wallet',
  leaderboard: '/leaderboard',
  onboarding: '/onboarding',

  // ── Legal / informational (now real pages). ──
  rules: '/rules',
  privacy: '/privacy',
  help: '/help',
  about: '/about',
} as const;

export type RouteKey = keyof typeof ROUTES;
export type RoutePath = (typeof ROUTES)[RouteKey];

/** A single navigable entry rendered across the header surfaces. */
export interface NavItem {
  /** Stable key (also used as a React key). */
  key: string;
  /** Visible label (Russian-first product). */
  label: string;
  /** Destination path. */
  href: RoutePath;
  /** Icon component from lucide-react. */
  icon: LucideIcon;
  /** Short description used for tooltips / aria descriptions / palette. */
  description: string;
  /**
   * Optional extra search terms (aliases) for the ⌘K palette so users can find
   * a page by a word that isn't in its label (e.g. "монеты" → wallet).
   */
  keywords?: readonly string[];
}

/**
 * PRIMARY navigation — the only links in the desktop bar. Deliberately tiny:
 * the roulette is the hero action, friends and the monetised Top round it out.
 * Everything else lives in the avatar menu / ⌘K palette. Order is intentional.
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  {
    key: 'video',
    label: 'Рулетка',
    href: ROUTES.video,
    icon: Video,
    description: 'Видеорулетка — случайные видеозвонки',
    keywords: ['видео', 'звонок', 'roulette', 'chat'],
  },
  {
    key: 'friends',
    label: 'Друзья',
    href: ROUTES.friends,
    icon: Users,
    description: 'Список друзей и заявки',
    keywords: ['friends', 'контакты'],
  },
  {
    key: 'top',
    label: 'Топ',
    href: ROUTES.top,
    icon: Trophy,
    description: 'Топ профилей — попади в ленту',
    keywords: ['рейтинг', 'лидеры', 'top'],
  },
] as const;

/**
 * SECONDARY destinations — surfaced in the avatar dropdown (and the drawer).
 * Profile / Settings live here per the brief; logout is rendered separately as
 * an action (it isn't a route).
 */
export const USER_MENU: readonly NavItem[] = [
  {
    key: 'me',
    label: 'Профиль',
    href: ROUTES.me,
    icon: UserRound,
    description: 'Твой профиль',
    keywords: ['аккаунт', 'profile', 'me'],
  },
  {
    key: 'chats',
    label: 'Чаты',
    href: ROUTES.chats,
    icon: MessagesSquare,
    description: 'Личные сообщения',
    keywords: ['сообщения', 'messages', 'dm'],
  },
  {
    key: 'wallet',
    label: 'Кошелёк',
    href: ROUTES.wallet,
    icon: CreditCard,
    description: 'Монеты, платежи и история',
    keywords: ['монеты', 'баланс', 'coins', 'оплата'],
  },
  {
    key: 'settings',
    label: 'Настройки',
    href: ROUTES.settings,
    icon: Settings,
    description: 'Аккаунт, приватность, уведомления',
    keywords: ['settings', 'приватность', 'профиль'],
  },
] as const;

/**
 * MOBILE drawer order — the full primary set plus the social/economy reaches,
 * grouped by intent. Used only by the mobile drawer (desktop stays minimal).
 */
export const MOBILE_NAV: readonly NavItem[] = [
  {
    key: 'dashboard',
    label: 'Дашборд',
    href: ROUTES.dashboard,
    icon: LayoutDashboard,
    description: 'Личный кабинет',
  },
  {
    key: 'video',
    label: 'Видеорулетка',
    href: ROUTES.video,
    icon: Video,
    description: 'Случайные видеозвонки',
  },
  {
    key: 'voice',
    label: 'Голосовая рулетка',
    href: ROUTES.voice,
    icon: Mic,
    description: 'Общение без камеры',
  },
  {
    key: 'friends',
    label: 'Друзья',
    href: ROUTES.friends,
    icon: Users,
    description: 'Список друзей и заявки',
  },
  {
    key: 'chats',
    label: 'Чаты',
    href: ROUTES.chats,
    icon: MessagesSquare,
    description: 'Личные сообщения',
  },
  {
    key: 'top',
    label: 'Топ',
    href: ROUTES.top,
    icon: Trophy,
    description: 'Топ профилей',
  },
  {
    key: 'me',
    label: 'Профиль',
    href: ROUTES.me,
    icon: UserRound,
    description: 'Твой профиль',
  },
  {
    key: 'settings',
    label: 'Настройки',
    href: ROUTES.settings,
    icon: Settings,
    description: 'Аккаунт и приватность',
  },
] as const;

/**
 * The full destination set (primary + secondary), de-duplicated by route.
 * Backwards-compatible export consumed by the site footer so it keeps listing
 * every section even though the header now shows only the primary few.
 */
export const NAV_ITEMS: readonly NavItem[] = (() => {
  const seen = new Set<string>();
  const all = [...PRIMARY_NAV, ...USER_MENU];
  return all.filter((item) => {
    if (seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });
})();

/**
 * Flat list powering the ⌘K command palette: every primary + secondary
 * destination plus a handful of utility pages that don't appear in any visible
 * menu but should still be quick to jump to.
 */
export const COMMAND_ITEMS: readonly NavItem[] = [
  ...PRIMARY_NAV,
  {
    key: 'voice',
    label: 'Голосовая рулетка',
    href: ROUTES.voice,
    icon: Mic,
    description: 'Общение без камеры',
    keywords: ['голос', 'voice', 'аудио'],
  },
  ...USER_MENU,
  {
    key: 'dashboard',
    label: 'Дашборд',
    href: ROUTES.dashboard,
    icon: LayoutDashboard,
    description: 'Личный кабинет',
    keywords: ['главная', 'home', 'hub'],
  },
  {
    key: 'search',
    label: 'Поиск людей',
    href: ROUTES.search,
    icon: Compass,
    description: 'Найти собеседников',
    keywords: ['discover', 'найти', 'люди'],
  },
  {
    key: 'notifications',
    label: 'Уведомления',
    href: ROUTES.notifications,
    icon: Sparkles,
    description: 'Центр уведомлений',
    keywords: ['notifications', 'оповещения'],
  },
  {
    key: 'gifts',
    label: 'Подарки',
    href: ROUTES.gifts,
    icon: Gift,
    description: 'Каталог подарков',
    keywords: ['gifts', 'презенты'],
  },
  {
    key: 'premium',
    label: 'Премиум',
    href: ROUTES.premium,
    icon: Trophy,
    description: 'Премиум-возможности',
    keywords: ['premium', 'подписка'],
  },
  {
    key: 'leaderboard',
    label: 'Лидерборд',
    href: ROUTES.leaderboard,
    icon: Trophy,
    description: 'Таблица лидеров',
    keywords: ['leaderboard', 'рейтинг'],
  },
] as const;

/** Convenience: the marketing/feature list surfaced on the landing page. */
export interface FeatureHighlight {
  /** Stable key into the `landing.features.*` message namespace (i18n source). */
  key: string;
  /** Russian source copy — kept as the canonical reference; the landing page
   *  renders the localized strings from messages, keyed by {@link key}. */
  title: string;
  description: string;
  href: RoutePath;
  icon: LucideIcon;
  /** Tailwind gradient stops used for the card's accent glow. */
  accent: string;
}

export const FEATURE_HIGHLIGHTS: readonly FeatureHighlight[] = [
  {
    key: 'video',
    title: 'Видеорулетка',
    description: 'Мгновенные видеозвонки со случайными собеседниками со всего мира.',
    href: ROUTES.video,
    icon: Video,
    accent: 'from-violet-500/30 to-fuchsia-500/10',
  },
  {
    key: 'voice',
    title: 'Голосовая рулетка',
    description: 'Только голос, когда не хочется включать камеру. Чисто и анонимно.',
    href: ROUTES.voice,
    icon: Mic,
    accent: 'from-cyan-400/30 to-sky-500/10',
  },
  {
    key: 'gifts',
    title: 'Подарки',
    description: 'Дари анимированные подарки за монеты прямо во время звонка.',
    href: ROUTES.top,
    icon: Sparkles,
    accent: 'from-amber-400/30 to-pink-500/10',
  },
  {
    key: 'friends',
    title: 'Друзья',
    description: 'Добавляй понравившихся собеседников и возвращайся к общению.',
    href: ROUTES.friends,
    icon: Users,
    accent: 'from-emerald-400/30 to-teal-500/10',
  },
  {
    key: 'premium',
    title: 'Премиум',
    description: 'Фильтры по полу и стране, без рекламы и приоритет в поиске.',
    href: ROUTES.top,
    icon: Trophy,
    accent: 'from-fuchsia-500/30 to-violet-500/10',
  },
] as const;
