'use client';

/**
 * First-visit intro preloader.
 *
 * On a visitor's very first load, a full-screen neon overlay plays a short
 * "roulette spin-up" of the logo over the signature aurora void, then fades to
 * reveal the app. Shown ONCE per browser (persisted in localStorage), so it
 * never interrupts returning users.
 *
 * Flash-free gating: the overlay is part of the server-rendered markup (so it
 * blankets the app from the first paint). An isomorphic layout effect removes it
 * *before paint* for anyone who has already seen it — returning users never see
 * a flicker. First-time visitors are marked "seen" immediately on mount, so a
 * fast refresh won't replay it.
 *
 * Honors `prefers-reduced-motion`: skips the spin/scale and dismisses quickly.
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Logo } from '@/components/brand/logo';

const SEEN_KEY = 'ruletka:intro-seen-v1';
const EASE = [0.16, 1, 0.3, 1] as const;

// useLayoutEffect on the client, useEffect on the server (avoids the SSR warning
// while still removing the overlay before paint for returning visitors).
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function Preloader() {
  const reduce = useReducedMotion();
  // Rendered by default so the very first paint is the intro (no app flash).
  const [show, setShow] = useState(true);

  useIsoLayoutEffect(() => {
    try {
      if (localStorage.getItem(SEEN_KEY)) {
        setShow(false); // returning visitor — remove before paint
      } else {
        localStorage.setItem(SEEN_KEY, '1'); // mark seen now; keep playing
      }
    } catch {
      // localStorage blocked (private mode) — just play it this once.
    }
  }, []);

  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setShow(false), reduce ? 900 : 2600);
    return () => clearTimeout(t);
  }, [show, reduce]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="ruletka-preloader"
          className="fixed inset-0 z-[2000] flex flex-col items-center justify-center overflow-hidden bg-background"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.6, ease: [0.4, 0, 0.2, 1] } }}
          aria-hidden="true"
          role="presentation"
        >
          {/* Aurora ambience. */}
          <div className="pointer-events-none absolute inset-0 bg-aurora-radial opacity-70" />
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[42rem] w-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,var(--color-neon-violet)_0%,transparent_62%)] opacity-30 blur-3xl" />

          {/* Logo spin-up — decelerating like a settling roulette wheel. */}
          <motion.div
            className="relative drop-shadow-[0_0_36px_rgba(170,107,255,0.55)]"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.55, rotate: 0 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: 540 }}
            transition={reduce ? { duration: 0.4 } : { duration: 1.7, ease: EASE }}
          >
            <Logo size={108} />
          </motion.div>

          {/* Wordmark reveal. */}
          <motion.div
            className="mt-9 font-display text-[2rem] font-extrabold leading-none tracking-tight"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduce ? 0.2 : 0.75, duration: 0.6, ease: EASE }}
          >
            ruletka<span className="text-gradient-neon">.top</span>
          </motion.div>

          {/* Neon progress sweep. */}
          {!reduce && (
            <div className="mt-7 h-[3px] w-44 overflow-hidden rounded-full bg-foreground/10">
              <motion.div
                className="h-full rounded-full bg-aurora"
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ delay: 0.55, duration: 1.7, ease: [0.4, 0, 0.2, 1] }}
              />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
