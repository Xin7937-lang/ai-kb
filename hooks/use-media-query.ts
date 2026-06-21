'use client';

import { useEffect, useState } from 'react';

/**
 * Reactive CSS media query hook. Returns false during SSR to avoid hydration
 * mismatch; updates to the correct value on the client after mount.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    function onChange(e: MediaQueryListEvent) {
      setMatches(e.matches);
    }
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
