'use client';

import { useEffect, useState } from 'react';

const HIDE_THRESHOLD = 60;
const DELTA = 4;

// scroll-down 且 scrollY > 60 -> hidden=true; scroll-up 任一像素 -> hidden=false.
// rAF throttle, 仅监听 window scroll (整页滚动模式).
export function useScrollDirection(): { hidden: boolean } {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let lastY = window.scrollY;
    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const y = window.scrollY;
        const dy = y - lastY;
        if (Math.abs(dy) > DELTA) {
          if (dy > 0 && y > HIDE_THRESHOLD) setHidden(true);
          else if (dy < 0) setHidden(false);
          lastY = y;
        }
        if (y <= HIDE_THRESHOLD) setHidden(false);
        ticking = false;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return { hidden };
}
