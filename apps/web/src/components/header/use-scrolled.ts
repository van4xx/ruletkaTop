'use client';

/**
 * `useScrolled` — a tiny, jank-free "has the page scrolled past N pixels?" hook.
 *
 * Reads `window.scrollY` inside a `requestAnimationFrame` callback (passive
 * listener) and only flips React state when the boolean threshold result
 * actually changes, so the header re-renders at most twice per scroll session
 * (crossing the threshold down, then back up) rather than on every wheel tick.
 */
import { useEffect, useState } from 'react';

export function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = 0;
    let last = scrolled;

    const read = () => {
      frame = 0;
      const next = window.scrollY > threshold;
      if (next !== last) {
        last = next;
        setScrolled(next);
      }
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(read);
    };

    // Sync once on mount (covers reloads scrolled mid-page / hash links).
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
    // `scrolled` intentionally excluded: `last` mirrors it via the closure and
    // re-subscribing on every flip would defeat the throttle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold]);

  return scrolled;
}
