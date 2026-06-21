'use client';

// Wraps TipTap content with an in-page search bar + DOM-based text
// highlighting. Works for both the read-only renderer and the
// editable editor — it operates on the painted DOM, not ProseMirror.

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { NoteSearchBar } from './note-search-bar';
import {
  highlightMatches,
  clearHighlights,
  focusMatch,
} from '@/lib/notes/search-text';

type Props = {
  /** Plain-text content, used to detect content changes and re-index. */
  contentText: string;
  /** Callback when search is closed. */
  onClose: () => void;
  /** Initial search query (e.g. from URL ?q=...). */
  initialQuery?: string;
  children: ReactNode;
};

export function NoteSearchableContent({
  contentText,
  onClose,
  initialQuery,
  children,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const marksRef = useRef<HTMLSpanElement[]>([]);
  const [query, setQuery] = useState(initialQuery ?? '');
  const [matchCount, setMatchCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  // Apply / refresh highlights whenever query or content changes.
  // requestAnimationFrame defers past TipTap's DOM reconciliation so
  // we always operate on the latest painted text.
  useEffect(() => {
    if (!query) {
      if (containerRef.current) {
        clearHighlights(containerRef.current);
      }
      marksRef.current = [];
      setMatchCount(0);
      setActiveIndex(0);
      return;
    }

    const raf = requestAnimationFrame(() => {
      const root = containerRef.current;
      if (!root) return;

      clearHighlights(root);
      const marks = highlightMatches(root, query);
      marksRef.current = marks;
      setMatchCount(marks.length);
      setActiveIndex(marks.length > 0 ? 0 : 0);
      // Scroll first match into view
      if (marks.length > 0) {
        focusMatch(marks, 0);
      }
    });

    return () => cancelAnimationFrame(raf);
  }, [query, contentText]);

  const handlePrev = useCallback(() => {
    const marks = marksRef.current;
    if (marks.length === 0) return;
    const next = (activeIndex - 1 + marks.length) % marks.length;
    setActiveIndex(next);
    focusMatch(marks, next);
  }, [activeIndex]);

  const handleNext = useCallback(() => {
    const marks = marksRef.current;
    if (marks.length === 0) return;
    const next = (activeIndex + 1) % marks.length;
    setActiveIndex(next);
    focusMatch(marks, next);
  }, [activeIndex]);

  const handleClose = useCallback(() => {
    if (containerRef.current) {
      clearHighlights(containerRef.current);
    }
    marksRef.current = [];
    setQuery('');
    setMatchCount(0);
    setActiveIndex(0);
    onClose();
  }, [onClose]);

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-1 px-1 pb-3 bg-background">
        <NoteSearchBar
          query={query}
          matchCount={matchCount}
          activeIndex={activeIndex}
          onChange={setQuery}
          onPrev={handlePrev}
          onNext={handleNext}
          onClose={handleClose}
        />
      </div>
      <div ref={containerRef}>{children}</div>
    </div>
  );
}
