// Chat conversation & message persistence — the data-access surface
// for the /chat module.
//
// Conventions (same as lib/notes/queries.ts):
// - All ids are nanoid(12). All timestamps are Unix ms.
// - Use getDb() / tx() from lib/db/client — never new Database().
// - Sources is stored as a JSON text array of {id, title}.

import { nanoid } from 'nanoid';
import { getDb, tx } from '@/lib/db/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConversationSource = {
  id: string;
  title: string;
};

export type ConversationMessage = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  sources: ConversationSource[] | null;
  createdAt: number;
};

export type ConversationSummary = {
  id: string;
  title: string;
  messageCount: number;
  lastPreview: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ConversationFull = {
  id: string;
  title: string;
  messages: ConversationMessage[];
  createdAt: number;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// Row shapes (what better-sqlite3 hands back)
// ---------------------------------------------------------------------------

type ConvRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
};

type ConvSummaryRow = ConvRow & {
  message_count: number;
  last_preview: string | null;
};

type MsgRow = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: string | null;
  created_at: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSources(raw: string | null): ConversationSource[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (s): s is ConversationSource =>
          s != null &&
          typeof s === 'object' &&
          typeof (s as Record<string, unknown>).id === 'string' &&
          typeof (s as Record<string, unknown>).title === 'string',
      );
    }
  } catch {
    // fall through
  }
  return null;
}

function rowToMessage(row: MsgRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    sources: parseSources(row.sources),
    createdAt: row.created_at,
  };
}

function rowToSummary(row: ConvSummaryRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    messageCount: row.message_count,
    lastPreview: row.last_preview,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Auto-title: first N chars of the first user message, trimmed. */
function autoTitle(content: string, max = 30): string {
  const cleaned = content.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max).trimEnd() + '…';
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Create a new conversation. Title defaults to "新对话" and is updated
 * automatically when the first user message is saved.
 */
export function createConversation(title = '新对话'): ConversationFull {
  const id = nanoid(12);
  const now = Date.now();
  getDb()
    .prepare(
      'INSERT INTO chat_conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    )
    .run(id, title, now, now);
  return { id, title, messages: [], createdAt: now, updatedAt: now };
}

/**
 * Get a single conversation with all its messages in chronological order.
 * Returns null if the conversation doesn't exist.
 */
export function getConversation(id: string): ConversationFull | null {
  const db = getDb();
  const conv = db
    .prepare<[string], ConvRow>(
      'SELECT * FROM chat_conversations WHERE id = ?',
    )
    .get(id);
  if (!conv) return null;

  const msgRows = db
    .prepare<[string], MsgRow>(
      'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
    )
    .all(id);

  return {
    id: conv.id,
    title: conv.title,
    messages: msgRows.map(rowToMessage),
    createdAt: conv.created_at,
    updatedAt: conv.updated_at,
  };
}

/**
 * List all conversations, newest first. Each summary includes the
 * message count and a preview of the last message.
 */
export function listConversations(): ConversationSummary[] {
  const rows = getDb()
    .prepare<[], ConvSummaryRow>(
      `SELECT c.*,
              (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id) AS message_count,
              (SELECT m.content FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_preview
         FROM chat_conversations c
         ORDER BY c.updated_at DESC`,
    )
    .all();
  return rows.map(rowToSummary);
}

/**
 * Add a single message to a conversation. Updates the conversation's
 * updated_at timestamp. If this is the first user message and the
 * conversation title is still "新对话", auto-update the title.
 */
export function addMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  sources?: ConversationSource[] | null,
): ConversationMessage {
  const id = nanoid(12);
  const now = Date.now();
  const sourcesJson = sources && sources.length > 0 ? JSON.stringify(sources) : null;

  tx((db) => {
    db.prepare(
      `INSERT INTO chat_messages (id, conversation_id, role, content, sources, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, conversationId, role, content, sourcesJson, now);

    db.prepare(
      'UPDATE chat_conversations SET updated_at = ? WHERE id = ?',
    ).run(now, conversationId);

    // Auto-title from first user message
    if (role === 'user') {
      const conv = db
        .prepare<[string], ConvRow>(
          'SELECT * FROM chat_conversations WHERE id = ?',
        )
        .get(conversationId);
      if (conv && conv.title === '新对话') {
        db.prepare('UPDATE chat_conversations SET title = ? WHERE id = ?').run(
          autoTitle(content),
          conversationId,
        );
      }
    }
  });

  return { id, conversationId, role, content, sources: sources ?? null, createdAt: now };
}

/**
 * Save a complete conversation turn (user message + assistant response)
 * in a single transaction. Auto-titles the conversation from the first
 * user message if the title is still the default.
 */
export function saveConversationTurn(
  conversationId: string,
  userContent: string,
  assistantContent: string,
  sources?: ConversationSource[] | null,
): { userMsg: ConversationMessage; assistantMsg: ConversationMessage } {
  const userId = nanoid(12);
  const assistantId = nanoid(12);
  const now = Date.now();
  const sourcesJson = sources && sources.length > 0 ? JSON.stringify(sources) : null;

  tx((db) => {
    db.prepare(
      `INSERT INTO chat_messages (id, conversation_id, role, content, sources, created_at)
       VALUES (?, ?, 'user', ?, NULL, ?)`,
    ).run(userId, conversationId, userContent, now);

    db.prepare(
      `INSERT INTO chat_messages (id, conversation_id, role, content, sources, created_at)
       VALUES (?, ?, 'assistant', ?, ?, ?)`,
    ).run(assistantId, conversationId, assistantContent, sourcesJson, now);

    db.prepare(
      'UPDATE chat_conversations SET updated_at = ? WHERE id = ?',
    ).run(now, conversationId);

    // Auto-title from first user message
    const conv = db
      .prepare<[string], ConvRow>(
        'SELECT * FROM chat_conversations WHERE id = ?',
      )
      .get(conversationId);
    if (conv && conv.title === '新对话') {
      db.prepare('UPDATE chat_conversations SET title = ? WHERE id = ?').run(
        autoTitle(userContent),
        conversationId,
      );
    }
  });

  return {
    userMsg: {
      id: userId,
      conversationId,
      role: 'user',
      content: userContent,
      sources: null,
      createdAt: now,
    },
    assistantMsg: {
      id: assistantId,
      conversationId,
      role: 'assistant',
      content: assistantContent,
      sources: sources ?? null,
      createdAt: now,
    },
  };
}

/**
 * Delete a single conversation. FK CASCADE cleans up messages.
 * Returns true if a row was actually deleted.
 */
export function deleteConversation(id: string): boolean {
  const result = getDb()
    .prepare('DELETE FROM chat_conversations WHERE id = ?')
    .run(id);
  return result.changes > 0;
}

/**
 * Batch-delete conversations by id. FK CASCADE cleans up messages.
 * Returns the number of conversations actually deleted.
 */
export function deleteConversations(ids: string[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const result = getDb()
    .prepare(`DELETE FROM chat_conversations WHERE id IN (${placeholders})`)
    .run(...ids);
  return result.changes;
}
