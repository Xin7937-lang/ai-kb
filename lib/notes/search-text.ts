// In-page content search: DOM text-node walker + <mark> highlight.
//
// Operates on the rendered DOM (after TipTap/ProseMirror has painted),
// so it works identically for the read-only renderer and the editable
// editor without touching ProseMirror state.
//
// Highlights are transient — any ProseMirror re-render (e.g. editing)
// will overwrite them. The caller re-applies after content changes.

export type TextMatch = {
  /** The DOM Text node containing this match. */
  node: Text;
  /** Start offset within the text node (codepoint index). */
  start: number;
  /** End offset within the text node (exclusive). */
  end: number;
};

/** Walk text nodes under `root`, collecting all case-insensitive matches. */
export function findMatches(root: HTMLElement, query: string): TextMatch[] {
  const q = query.toLowerCase();
  if (!q) return [];

  const matches: TextMatch[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    // Skip nodes inside the search bar itself
    if (node.parentElement?.closest('[data-search-bar]')) continue;
    // Skip nodes already inside a highlight <mark> (leftover from a
    // previous highlight pass that wasn't cleaned up)
    if (node.parentElement?.closest('mark[data-search-match]')) continue;

    const text = node.nodeValue ?? '';
    const lower = text.toLowerCase();
    let idx = 0;
    while ((idx = lower.indexOf(q, idx)) !== -1) {
      matches.push({ node, start: idx, end: idx + q.length });
      idx += q.length;
    }
  }
  return matches;
}

/**
 * Wrap every match in a <mark data-search-match> element.
 * Returns the array of created <mark> elements so the caller can
 * navigate between them.
 *
 * Must be called on a DOM that has NO existing search highlights
 * (call {@link clearHighlights} first if unsure).
 */
export function highlightMatches(
  root: HTMLElement,
  query: string,
): HTMLSpanElement[] {
  const matches = findMatches(root, query);
  if (matches.length === 0) return [];

  // Process matches in reverse document order so the offsets of
  // earlier matches aren't invalidated by our splitText calls.
  // Within the same text node, process matches in reverse order.
  const marks: HTMLSpanElement[] = [];
  let globalIdx = matches.length - 1;

  // Group by text node so we can process per-node in reverse.
  const byNode = new Map<Text, TextMatch[]>();
  for (const m of matches) {
    const list = byNode.get(m.node) ?? [];
    list.push(m);
    byNode.set(m.node, list);
  }

  for (const [textNode, nodeMatches] of byNode) {
    // Sort by start offset ascending (natural order), but we'll
    // iterate in reverse so splitText offsets stay valid.
    nodeMatches.sort((a, b) => a.start - b.start);

    for (let i = nodeMatches.length - 1; i >= 0; i--) {
      const m = nodeMatches[i];
      // Split at end first, then at start — this isolates the match
      // as a standalone text node we can wrap.
      const after = textNode.splitText(m.end);
      const matchText = textNode.splitText(m.start);

      const mark = document.createElement('mark');
      mark.setAttribute('data-search-match', '');
      mark.setAttribute('data-search-index', String(globalIdx));
      mark.className = 'bg-yellow-200 dark:bg-yellow-800 rounded-sm';

      matchText.parentNode?.insertBefore(mark, matchText);
      mark.appendChild(matchText);

      marks[globalIdx] = mark;
      globalIdx--;
    }
  }

  // Reverse so index 0 = first match in document order
  return marks.reverse();
}

/**
 * Remove all search highlights from the DOM, merging adjacent text
 * nodes so the document is restored to its pre-search state.
 */
export function clearHighlights(root: HTMLElement): void {
  const marks = root.querySelectorAll('mark[data-search-match]');
  // Iterate in reverse — replacing earlier marks could invalidate
  // later references if they share a parent.
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i];
    const parent = mark.parentNode;
    if (!parent) continue;
    const text = document.createTextNode(mark.textContent ?? '');
    parent.replaceChild(text, mark);
  }
  // Merge adjacent text nodes created by the unwrap.
  root.normalize();
}

/**
 * Scroll the Nth match into view and add a visual "active" class.
 * Removes the active class from the previously focused match.
 */
export function focusMatch(
  marks: HTMLSpanElement[],
  index: number,
): void {
  // Clear previous active
  for (const m of marks) {
    m.classList.remove('ring-2', 'ring-primary', 'bg-orange-300', 'dark:bg-orange-700');
  }

  const target = marks[index];
  if (!target) return;

  target.classList.add('ring-2', 'ring-primary', 'bg-orange-300', 'dark:bg-orange-700');
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
