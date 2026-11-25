'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Safety net for the scroll position after a link click: every new page opens at the top. Next.js
 * already does this (with `data-scroll-behavior="smooth"` on `<html>`, app/layout.tsx); this guards
 * against a page whose first element Next.js skips (sticky header) or measures wrongly.
 *
 * It leaves two cases to the browser: links with a hash (`/#preise` jumps to its section) and
 * back/forward (`popstate`), where the browser restores the previous scroll position.
 */
export function ScrollToTopOnRouteChange() {
  const pathname = usePathname();
  const first = useRef(true);
  const fromHistory = useRef(false);

  useEffect(() => {
    const onPop = () => {
      fromHistory.current = true;
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false; // the first load: the browser decides (reload keeps the position)
      return;
    }
    if (fromHistory.current) {
      fromHistory.current = false;
      return;
    }
    if (location.hash) return;
    scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);

  return null;
}
