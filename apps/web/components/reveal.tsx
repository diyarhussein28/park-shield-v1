'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Fades `[data-reveal]` elements in as they scroll into view (styles in app/globals.css).
 * Whatever is already on screen when the page loads is shown at once, so nothing flickers; anything
 * above the viewport (after an anchor jump) is revealed too. With reduced motion nothing is hidden.
 */
export function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let pending = [...el.querySelectorAll<HTMLElement>('[data-reveal]')];
    let frame = 0;
    function stop() {
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onScroll);
    }
    function show(threshold: number) {
      pending = pending.filter((item) => {
        if (item.getBoundingClientRect().top >= threshold) return true;
        item.dataset.shown = '';
        return false;
      });
      if (!pending.length) stop();
    }
    function onScroll() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => show(innerHeight * 0.92));
    }
    show(innerHeight);
    el.classList.add('reveal-armed');
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll, { passive: true });
    return () => {
      stop();
      cancelAnimationFrame(frame);
      el.classList.remove('reveal-armed');
    };
  }, [root]);
}
