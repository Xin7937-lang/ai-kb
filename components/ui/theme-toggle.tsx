'use client';

// Light/dark theme toggle. Reads/updates the `dark` class on <html>,
// which Tailwind uses for dark mode (configured as `darkMode: ['class']`).
// Persists preference in localStorage so it survives reloads.

import { useState, useEffect, useCallback } from 'react';
import { Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'theme';

function getStoredTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // localStorage unavailable (e.g. incognito)
  }
  // Fall back to system preference
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

function applyTheme(theme: 'dark' | 'light') {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('light');

  // Hydrate from localStorage on mount (avoids flash)
  useEffect(() => {
    const t = getStoredTheme();
    setTheme(t);
    applyTheme(t);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      title={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
      aria-label={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
    >
      {theme === 'dark' ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </Button>
  );
}
