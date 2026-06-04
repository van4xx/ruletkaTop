'use client';

/**
 * Voice-stage layout switcher — a compact segmented control for picking between
 * the two /voice visual layouts (`equalizer` ↔ `orb`).
 *
 * It is a frosted `glass-panel rounded-full` pill holding one {@link IconButton}
 * per entry in {@link VOICE_LAYOUTS}: the active layout's pebble lights up in the
 * primary neon, the rest are glass. Each is wrapped in a {@link Tooltip} and
 * carries an `aria-label` resolved from the `voiceLayout.*` i18n block.
 *
 * A11y: the pill is a `role="radiogroup"`; each button is `role="radio"` with
 * `aria-checked`, so it reads as a single-select group to assistive tech.
 *
 * This is pure presentation — clicking only swaps which visualizer is rendered
 * (and persists the choice via {@link setVoiceLayout}); it never touches the
 * live WebRTC session.
 */
import { useTranslations } from 'next-intl';
import {
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@ruletka/ui';
import {
  VOICE_LAYOUTS,
  setVoiceLayout,
  useVoiceLayout,
  type VoiceLayoutId,
} from '@/lib/stores/voice-layout-store';
import { cn } from '@/lib/cn';

export interface VoiceLayoutSwitcherProps {
  className?: string;
}

export function VoiceLayoutSwitcher({ className }: VoiceLayoutSwitcherProps) {
  const t = useTranslations('roulette');
  const active = useVoiceLayout();

  return (
    <TooltipProvider>
      <div
        role="radiogroup"
        aria-label={t('voiceLayout.switch')}
        className={cn(
          'glass-panel flex items-center gap-1 rounded-full p-1',
          className,
        )}
      >
        {VOICE_LAYOUTS.map(({ id, icon: Icon, labelKey }) => {
          const selected = active === id;
          const label = t(`voiceLayout.${labelKey}` as `voiceLayout.${VoiceLayoutId}`);
          return (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <IconButton
                  size="sm"
                  shape="circle"
                  variant={selected ? 'primary' : 'glass'}
                  role="radio"
                  aria-checked={selected}
                  aria-label={label}
                  onClick={() => setVoiceLayout(id)}
                >
                  <Icon />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
