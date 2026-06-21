// Pure text chunking for embedding.
//
// Splits a note's plain-text content into 800-char chunks with a 100-char
// sliding window of overlap, preserving structural boundaries (paragraph
// breaks, Markdown headings, list items, table rows) and never splitting
// inside a sentence.
//
// Output is consumed by `lib/ai/embeddings.ts` and indexed in
// `note_chunks` / `note_chunks_vec`.

const TARGET_CHUNK_CHARS = 800;
const OVERLAP_CHARS = 100;
const SHORT_CONTENT_THRESHOLD = 100;
const HARD_CONTENT_MAX_CHARS = 50000;

export type Chunk = {
  content: string;
  startPos: number;
  endPos: number;
  chunkIndex: number;
};

const SENTENCE_TERMINATORS = /([。！？.!?\n])/g;

function hardSplit(input: string): string[] {
  // Split on double newlines, Markdown headings, list items, and table
  // rows. Each match keeps its separator so the original whitespace
  // structure is preserved in the chunk content.
  const re = /(\n\n+|^#{1,6}\s.*$|^[-*+]\s.*$|^\|.*\|$)/gm;
  const segments: string[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m.index > lastIdx) {
      segments.push(input.slice(lastIdx, m.index));
    }
    lastIdx = m.index;
  }
  if (lastIdx < input.length) {
    segments.push(input.slice(lastIdx));
  }
  return segments
    .flatMap((s) => s.split(/\n\n+/))
    .filter((s) => s.length > 0);
}

function softSplit(segment: string): string[] {
  // Walk the segment, accumulate up to TARGET_CHUNK_CHARS, cut on the
  // last sentence terminator within the window. Never split mid-sentence.
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < segment.length) {
    const remaining = segment.length - cursor;
    if (remaining <= TARGET_CHUNK_CHARS) {
      parts.push(segment.slice(cursor));
      break;
    }
    const window = segment.slice(cursor, cursor + TARGET_CHUNK_CHARS);
    let lastTerm = -1;
    let match: RegExpExecArray | null;
    SENTENCE_TERMINATORS.lastIndex = 0;
    while ((match = SENTENCE_TERMINATORS.exec(window)) !== null) {
      lastTerm = match.index + match[0].length;
    }
    const cut = lastTerm > 0 ? lastTerm : TARGET_CHUNK_CHARS;
    parts.push(segment.slice(cursor, cursor + cut));
    cursor += cut;
  }
  return parts;
}

function applyOverlap(parts: string[]): string[] {
  if (parts.length <= 1) return parts;
  const result: string[] = [parts[0]];
  for (let i = 1; i < parts.length; i++) {
    const prev = parts[i - 1];
    const overlap = prev.slice(Math.max(0, prev.length - OVERLAP_CHARS));
    result.push(overlap + parts[i]);
  }
  return result;
}

export function chunkNote(rawContent: string): Chunk[] {
  const content = (rawContent ?? '').slice(0, HARD_CONTENT_MAX_CHARS).trim();
  if (content.length === 0) return [];

  const segments = hardSplit(content);
  // Short content with no internal structure: one chunk, the whole content.
  if (segments.length === 1 && content.length <= SHORT_CONTENT_THRESHOLD) {
    return [
      {
        content,
        startPos: 0,
        endPos: content.length,
        chunkIndex: 0,
      },
    ];
  }

  // Overlap applies only within the soft-split output of a single
  // long segment — structural hard-split boundaries are preserved
  // verbatim and never bleed into adjacent segments.
  const parts: string[] = segments.flatMap((seg) =>
    seg.length <= TARGET_CHUNK_CHARS ? [seg] : applyOverlap(softSplit(seg)),
  );

  let cursor = 0;
  return parts.map((part, i) => {
    const start = content.indexOf(part, cursor);
    const end = start >= 0 ? start + part.length : cursor + part.length;
    cursor = Math.max(end - OVERLAP_CHARS, cursor);
    return {
      content: part,
      startPos: start >= 0 ? start : 0,
      endPos: end,
      chunkIndex: i,
    };
  });
}
