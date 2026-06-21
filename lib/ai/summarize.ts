// S8 — note summarization pipeline.
//
// Owns the lifecycle of a single summarize request: load the note, truncate
// the text to `SUMMARY_INPUT_MAX_CHARS`, resolve the default (or requested)
// model, run `streamText` from the Vercel AI SDK, and emit an SSE-formatted
// `ReadableStream` of events. After the AI stream completes, the full text
// is persisted to `notes.summary` and `summary_state` flips to 'fresh'. If
// the stream errors, `summary_state` flips to 'stale' so the UI knows the
// previous summary (if any) is no longer trustworthy and a retry is needed.

import { generateText, streamText } from 'ai';
import { getDb } from '@/lib/db/client';
import { SUMMARY_INPUT_MAX_CHARS } from '@/lib/env';
import { getDefaultModelId, getModelAndClient } from './provider';
import { NoDefaultModelError, NoSuchModelError } from './errors';
import {
  SUGGEST_TAGS_SYSTEM_PROMPT,
  SUGGEST_TAGS_USER_TEMPLATE,
  SUMMARIZE_SYSTEM_PROMPT,
  SUMMARIZE_USER_TEMPLATE,
} from './prompts';
import { setNoteTags, getNote } from '@/lib/notes/queries';

export type SummaryStreamResult = {
  /** SSE-formatted byte stream (`data: <json>\n\n` events). */
  stream: ReadableStream<Uint8Array>;
  /** The AI SDK's model identifier (e.g. "gpt-4o-mini"). */
  modelId: string;
  /** The user-facing name of the model config row that produced it. */
  modelName: string;
};

export type StreamSummaryOptions = {
  /**
   * Override the default model. The value is the `model_configs.id` row id
   * (NOT the AI SDK `model` field). When omitted we fall back to the row
   * whose `is_default = 1`.
   */
  modelId?: string;
};

/**
 * Build the SSE byte stream for a single note summary. The returned stream
 * emits:
 *   - one `data: {"delta": "..."}\n\n` per text delta
 *   - exactly one terminal event — either
 *     `data: {"done": true, "summary": "..."}\n\n` (on success) or
 *     `data: {"error": "..."}\n\n` (on failure)
 *
 * The note's `summary_state` is set to 'generating' before the AI call
 * starts, then to 'fresh' on success or 'stale' on error.
 *
 * Throws synchronously (before streaming starts) only for setup errors:
 *   - `Error('note_not_found')` if the note id doesn't exist
 *   - `NoDefaultModelError` if no default model is configured and no
 *     `opts.modelId` was supplied
 *   - `NoSuchModelError` if `opts.modelId` is set but doesn't match a row
 */
export async function streamSummary(
  noteId: string,
  opts: StreamSummaryOptions = {},
): Promise<SummaryStreamResult> {
  const note = getNoteRow(noteId);
  if (!note) {
    throw new Error('note_not_found');
  }

  const modelConfigId = opts.modelId ?? getDefaultModelId();
  const { client, modelId, modelName } = getModelAndClient(modelConfigId);

  const truncated = truncateForPrompt(note.content_text);
  const userPrompt = SUMMARIZE_USER_TEMPLATE(truncated);

  // Flip state to 'generating' before we start the AI call so any concurrent
  // page render reflects the in-flight status.
  markSummaryGenerating(noteId);

  // Kick off the AI call. `streamText` returns a handle with an async-iterable
  // `textStream` of deltas. We pipe that into a Web `ReadableStream` and
  // encode each delta as an SSE event.
  const result = await streamText({
    model: client.chat(modelId),
    system: SUMMARIZE_SYSTEM_PROMPT,
    prompt: userPrompt,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let accumulated = '';
      try {
        for await (const delta of result.textStream) {
          if (!delta) continue;
          accumulated += delta;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`),
          );
        }
        // Success: persist the full text, then signal completion.
        markSummaryFresh(noteId, accumulated);

        // Best-effort: ask the same model to suggest up to 3 tags.
        // We force this on EVERY summary run (not just when the note
        // has no tags) so users get fresh AI suggestions each time
        // they re-summarize. Existing tags are MERGED with the
        // suggestions, not replaced -- see `suggestTags` for the
        // dedupe logic. We await so the stream doesn't close until
        // tags are persisted; the next `router.refresh()` from the
        // client then shows the new tags alongside the summary.
        let autoTags: string[] = [];
        try {
          autoTags = await suggestTags(noteId, modelConfigId, { force: true });
        } catch (err) {
          console.error('[ai/summarize] auto-tag step threw:', err);
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              done: true,
              summary: accumulated,
              // Always include `autoTags` (possibly empty). The client
              // uses presence-as-array to distinguish "auto-tag ran
              // and returned nothing" (e.g. the model emitted "无"
              // for content it considered untaggable) from "auto-tag
              // wasn't attempted". Hiding the field when empty made
              // the step look like it never happened.
              autoTags,
            })}\n\n`,
          ),
        );
        controller.close();
      } catch (err) {
        // Failure: revert the in-flight marker so the UI can show "stale" and
        // surface a retry. We do NOT clear the existing summary column — the
        // old text is still better than nothing.
        try {
          markSummaryStale(noteId);
        } catch (markErr) {
          console.error('[ai/summarize] failed to mark stale:', markErr);
        }
        const message = errorMessage(err);
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`),
          );
        } finally {
          controller.close();
        }
      }
    },
  });

  return { stream, modelId, modelName };
}

/**
 * Mark a note as mid-generation. Called by `streamSummary` before the AI
 * request starts. The UI uses this to disable the button and show a
 * spinner-style label.
 */
export function markSummaryGenerating(noteId: string): void {
  getDb()
    .prepare('UPDATE notes SET summary_state = ? WHERE id = ?')
    .run('generating', noteId);
}

/**
 * Persist the freshly generated summary and mark the note as up-to-date.
 * `updated_at` is refreshed too so the note bubbles to the top of the list.
 */
export function markSummaryFresh(noteId: string, summary: string): void {
  getDb()
    .prepare(
      'UPDATE notes SET summary = ?, summary_state = ?, updated_at = ? ' +
        'WHERE id = ?',
    )
    .run(summary, 'fresh', Date.now(), noteId);
}

/**
 * Internal helper: revert the in-flight marker when summarization fails.
 * We keep the existing `summary` column intact — the previous summary is
 * still a better default than nothing.
 */
function markSummaryStale(noteId: string): void {
  getDb()
    .prepare('UPDATE notes SET summary_state = ? WHERE id = ?')
    .run('stale', noteId);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type NoteRow = { content_text: string };

function getNoteRow(noteId: string): NoteRow | null {
  const row = getDb()
    .prepare<[string], NoteRow>('SELECT content_text FROM notes WHERE id = ?')
    .get(noteId);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Tag auto-suggestion (runs after a successful summary if note has no tags)
// ---------------------------------------------------------------------------

const MAX_AUTO_TAGS = 3;

/**
 * Parse the model's tag-suggestion output. The prompt asks for
 * "tag1, tag2, tag3" (or the single token "无"). We tolerate:
 *   - extra whitespace
 *   - bullet markers (`- `, `* `, `1. `)
 *   - quoted tags (single/double/backtick)
 *   - JSON-ish brackets wrapping the whole reply (`[a, b]`, `(a, b)`,
 *     `{a, b}`) -- some chat clients / strict-mode models emit these
 *   - the literal "无" / "none" / empty output
 */
export function parseTagSuggestions(raw: string): string[] {
  if (!raw) return [];
  const cleaned = raw
    .replace(/["'`*_]/g, '')
    .replace(/^[\s\-•·\[\({<]+/, '')
    .replace(/[\s\]}\)>]+$/, '')
    .trim();
  if (!cleaned) return [];
  if (/^(无|none|n\/a|-)$/i.test(cleaned)) return [];
  // Split on common separators; keep the order the model emitted.
  const parts = cleaned
    .split(/[,，;；\n\r\t|]+/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0 && p.length <= 32);
  // Dedupe while preserving order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
      if (out.length >= MAX_AUTO_TAGS) break;
    }
  }
  return out;
}

/**
 * Suggest and persist up to 3 tags for a note using the configured model.
 * Best-effort: returns [] on any failure (no model, no note, LLM error).
 *
 *   - `force: false` (default) — only fires when the note currently has
 *     zero tags (the original MVP behavior: a tagless note gets a small
 *     suggested set after its first summary).
 *   - `force: true` — fires regardless of existing tags. Used both for
 *     imports and for the "re-summarize" flow so the user always gets
 *     fresh suggestions. **The suggestions are MERGED with the note's
 *     existing tags** (deduped), never replaced -- this preserves
 *     manually-curated tags from the user.
 */
export async function suggestTags(
  noteId: string,
  modelConfigId: string,
  opts: { force?: boolean } = {},
): Promise<string[]> {
  const note = getNote(noteId);
  if (!note) return [];
  if (!opts.force && note.tags.length > 0) return [];

  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    const { client, modelId } = getModelAndClient(modelConfigId);
    const truncated = truncateForPrompt(note.contentText);
    result = await generateText({
      model: client.chat(modelId),
      system: SUGGEST_TAGS_SYSTEM_PROMPT,
      prompt: SUGGEST_TAGS_USER_TEMPLATE(note.title, truncated),
      // Most tag-suggestion calls are short; cap tokens to keep cost down.
      maxTokens: 60,
      temperature: 0.2,
    });
  } catch (err) {
    console.error('[ai/summarize] tag suggestion failed:', err);
    return [];
  }

  const suggestions = parseTagSuggestions(result.text);
  if (suggestions.length === 0) return [];

  // Build the final tag set:
  //   - force=false (note was tagless): replace with suggestions
  //   - force=true (already had tags): merge suggestions into existing,
  //     deduped, order = existing first then new
  const finalTags = opts.force
    ? Array.from(new Set([...note.tags, ...suggestions]))
    : suggestions;

  try {
    setNoteTags(noteId, finalTags);
  } catch (err) {
    console.error('[ai/summarize] failed to persist auto-tags:', err);
    return [];
  }

  return suggestions;
}

/**
 * Backward-compat wrapper. Prefer `suggestTags` with explicit `opts`.
 */
export async function suggestTagsIfMissing(
  noteId: string,
  modelConfigId: string,
): Promise<string[]> {
  return suggestTags(noteId, modelConfigId, { force: false });
}

/**
 * Truncate `content_text` to `SUMMARY_INPUT_MAX_CHARS` and prepend the
 * `[内容已截断]` marker so the model knows it's seeing an excerpt. Pure
 * function — exported for testability even though no caller uses it today.
 */
function truncateForPrompt(text: string): string {
  if (!text) return '';
  if (text.length <= SUMMARY_INPUT_MAX_CHARS) return text;
  return `[内容已截断]\n${text.slice(0, SUMMARY_INPUT_MAX_CHARS)}`;
}

function errorMessage(err: unknown): string {
  if (err instanceof NoSuchModelError) return 'no_such_model';
  if (err instanceof NoDefaultModelError) return 'no_default_model';
  if (err instanceof Error) {
    return err.message || err.name || 'unknown_error';
  }
  return 'unknown_error';
}
