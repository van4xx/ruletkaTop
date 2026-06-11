/**
 * Map the catalogue's `icon` strings (a closed lucide-react enum on the shared
 * contract) → the actual lucide React components. Kept as a SEPARATE file from
 * the grid so a code-split chunk (the page route) pays the icon-tree cost on
 * demand instead of bundling lucide-react into every profile read.
 *
 * Any catalogue icon NOT in this map renders a fallback `Sparkles` — defensive
 * so a future contract addition doesn't blank the badge while it's being
 * rolled out (the wire shape stays valid even if the FE hasn't shipped the
 * matching icon yet).
 */
import type { ComponentType, SVGProps } from 'react';
import {
  Award,
  Cake,
  Calendar,
  Coins,
  Compass,
  Crown,
  Flame,
  Gem,
  Gift,
  Heart,
  Medal,
  MessageCircle,
  MessageSquare,
  Mic,
  Moon,
  Phone,
  Rocket,
  Send,
  Shield,
  Sparkles,
  Star,
  Sunrise,
  Target,
  Trophy,
  UserPlus,
  Users,
  Video,
  Zap,
} from 'lucide-react';
import type { AchievementIconName } from '@ruletka/shared-types';

/** A renderable React component the grid feeds into a wrapper styled cell. */
export type AchievementIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** Closed map; adding a new icon means extending BOTH this map and the schema. */
const ICONS: Record<AchievementIconName, AchievementIcon> = {
  trophy: Trophy,
  star: Star,
  flame: Flame,
  sparkles: Sparkles,
  heart: Heart,
  crown: Crown,
  medal: Medal,
  award: Award,
  gift: Gift,
  coins: Coins,
  users: Users,
  'user-plus': UserPlus,
  'message-square': MessageSquare,
  'message-circle': MessageCircle,
  phone: Phone,
  video: Video,
  mic: Mic,
  moon: Moon,
  sunrise: Sunrise,
  calendar: Calendar,
  cake: Cake,
  rocket: Rocket,
  gem: Gem,
  zap: Zap,
  shield: Shield,
  target: Target,
  compass: Compass,
  send: Send,
};

/** Resolve an icon name → component; falls back to `Sparkles`. */
export function resolveAchievementIcon(name: AchievementIconName | string): AchievementIcon {
  return ICONS[name as AchievementIconName] ?? Sparkles;
}

/**
 * Tier → glow color token. We use the existing neon palette + the
 * `--color-neon-amber` / `--color-neon-cyan` / `--color-neon-violet` CSS
 * custom properties from `globals.css` so badge glows feel native to the
 * rest of the chrome. Keep these in sync with the `<style>` block in
 * `achievements-strip.tsx` if you ever swap palettes.
 */
export function tierColorVar(tier: 1 | 2 | 3): string {
  if (tier === 3) return 'var(--color-neon-amber, #f5b840)';
  if (tier === 2) return 'var(--color-neon-cyan, #6ee7ff)';
  return 'var(--color-neon-violet, #c084fc)';
}

/** Human-readable tier name for the tooltip / aria-label. */
export function tierName(tier: 1 | 2 | 3): 'bronze' | 'silver' | 'gold' {
  if (tier === 3) return 'gold';
  if (tier === 2) return 'silver';
  return 'bronze';
}
