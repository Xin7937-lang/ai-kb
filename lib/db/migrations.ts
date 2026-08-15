// Inline migration definitions.
//
// We keep migrations as TypeScript functions rather than .sql files so they
// version-control cleanly, can use JS for branching, and don't require an
// extra build step. The plan's §4 schema lives here verbatim.

import type { Database } from 'better-sqlite3';
import { getLoadablePath } from 'sqlite-vec';

type Migration = {
  version: number;
  name: string;
  up: (db: Database) => void;
};

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: (db) => {
      db.exec(`
        -- Global settings: password hash, default model id, etc.
        CREATE TABLE settings (
          key   TEXT PRIMARY KEY,
          value TEXT
        );

        -- Notes
        CREATE TABLE notes (
          id            TEXT    PRIMARY KEY,
          title         TEXT    NOT NULL,
          content_json  TEXT    NOT NULL,
          content_text  TEXT    NOT NULL,
          summary       TEXT,
          summary_state TEXT    NOT NULL DEFAULT 'none', -- none | fresh | stale | generating
          created_at    INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL
        );

        CREATE INDEX idx_notes_updated_at ON notes(updated_at DESC);
        CREATE INDEX idx_notes_summary_state ON notes(summary_state);

        -- FTS5 virtual table; kept in sync via triggers.
        CREATE VIRTUAL TABLE notes_fts USING fts5(
          title,
          content_text,
          content='notes',
          content_rowid='rowid',
          tokenize='unicode61'
        );

        -- FTS sync triggers
        CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts(rowid, title, content_text)
          VALUES (new.rowid, new.title, new.content_text);
        END;

        CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, content_text)
          VALUES ('delete', old.rowid, old.title, old.content_text);
        END;

        CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, content_text)
          VALUES ('delete', old.rowid, old.title, old.content_text);
          INSERT INTO notes_fts(rowid, title, content_text)
          VALUES (new.rowid, new.title, new.content_text);
        END;

        -- Tags
        CREATE TABLE tags (
          id   INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT    NOT NULL UNIQUE
        );

        CREATE TABLE note_tags (
          note_id TEXT    NOT NULL,
          tag_id  INTEGER NOT NULL,
          PRIMARY KEY (note_id, tag_id),
          FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id)  REFERENCES tags(id)  ON DELETE CASCADE
        );

        CREATE INDEX idx_note_tags_note ON note_tags(note_id);
        CREATE INDEX idx_note_tags_tag  ON note_tags(tag_id);

        -- Image assets
        CREATE TABLE assets (
          id         TEXT    PRIMARY KEY,
          note_id    TEXT,
          rel_path   TEXT    NOT NULL,
          mime       TEXT,
          size       INTEGER,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE SET NULL
        );

        CREATE INDEX idx_assets_note ON assets(note_id);

        -- Model configurations (API key stored AES-256-GCM encrypted)
        CREATE TABLE model_configs (
          id          TEXT    PRIMARY KEY,
          name        TEXT    NOT NULL,
          base_url    TEXT    NOT NULL,
          api_key_enc TEXT    NOT NULL,
          model       TEXT    NOT NULL,
          is_default  INTEGER NOT NULL DEFAULT 0,
          created_at  INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX idx_model_configs_default
          ON model_configs(is_default)
          WHERE is_default = 1;
      `);
    },
  },
  {
    // v2: tag ordering + built-in 收藏 tag.
    //
    // 1. Add tags.position (default 999999 so newly-untouched tags sort last).
    // 2. Backfill: assign 0, 1, 2, ... to existing tags in their current
    //    count-DESC / name-ASC order (matches the previous default UI sort).
    // 3. Shift every existing position up by 1 so we can put 收藏 at 0
    //    without colliding with whatever previously sat at 0.
    // 4. Ensure the 收藏 tag exists at position 0 (insert if missing,
    //    promote an existing 收藏 row to 0 if the user already created it).
    version: 2,
    name: 'tag_position_and_favorites',
    up: (db) => {
      db.exec(
        'ALTER TABLE tags ADD COLUMN position INTEGER NOT NULL DEFAULT 999999;',
      );

      // Backfill in JS — SQLite's ROW_NUMBER() OVER () works in modern
      // versions but the JS path is shorter and version-agnostic.
      const all = db
        .prepare<[], { id: number; name: string; count: number }>(
          `SELECT t.id, t.name,
                  (SELECT COUNT(*) FROM note_tags nt WHERE nt.tag_id = t.id) AS count
             FROM tags t
             ORDER BY count DESC, t.name ASC`,
        )
        .all();
      const assignPos = db.prepare(
        'UPDATE tags SET position = ? WHERE id = ?',
      );
      for (let i = 0; i < all.length; i++) {
        assignPos.run(i, all[i].id);
      }

      // Make room for 收藏 at 0.
      db.exec('UPDATE tags SET position = position + 1;');

      // Upsert 收藏 at position 0. If the user already created one, just
      // promote it; otherwise insert a fresh row.
      db.exec(
        `INSERT INTO tags (name, position) VALUES ('收藏', 0)
           ON CONFLICT(name) DO UPDATE SET position = 0;`,
      );
    },
  },
  {
    // v3: note chunks + sqlite-vec vector index.
    //
    // This migration does NOT embed any existing data. Run
    // `npm run embed-all` after this migration to backfill the chunk
    // vectors for notes that were created before v3.
    version: 3,
    name: 'note_chunks_and_embedding_models',
    up: (db) => {
      db.exec(`
        CREATE TABLE note_chunks (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          note_id     TEXT    NOT NULL,
          chunk_index INTEGER NOT NULL,
          content     TEXT    NOT NULL,
          start_pos   INTEGER NOT NULL,
          end_pos     INTEGER NOT NULL,
          created_at  INTEGER NOT NULL,
          FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
          UNIQUE (note_id, chunk_index)
        );
        CREATE INDEX idx_note_chunks_note_id ON note_chunks(note_id);
      `);

      // sqlite-vec vec0 virtual table. Dimension is fixed at 1024 to
      // match Qwen text-embedding-v3. Bumping the dimension requires
      // a new migration that re-embeds every row.
      //
      // The virtual table creation is guarded: if the sqlite-vec
      // extension is not loaded on this system, the chunks table is
      // still created and the migration completes (with a warning).
      // A proper loader is added in Phase 3.1; until then, the
      // embedding write path will skip writing vectors.
      try {
        db.exec(`
          CREATE VIRTUAL TABLE note_chunks_vec USING vec0(
            chunk_id INTEGER PRIMARY KEY,
            embedding float[1024]
          );
        `);
      } catch (e) {
        console.warn(
          '[db] v3: sqlite-vec extension not available, ' +
            'skipping note_chunks_vec creation: ' +
            (e instanceof Error ? e.message : String(e)),
        );
      }
    },
  },
  {
    // v4: model_configs.kind column. Existing rows default to 'chat'.
    // The default flag is now unique per (kind) instead of globally
    // unique, so we drop the old partial index and add a new one.
    version: 4,
    name: 'model_kind_column',
    up: (db) => {
      db.exec(`
        ALTER TABLE model_configs ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';
        DROP INDEX IF EXISTS idx_model_configs_default;
        CREATE UNIQUE INDEX idx_model_configs_default_per_kind
          ON model_configs(kind)
          WHERE is_default = 1;
        CREATE INDEX idx_model_configs_kind ON model_configs(kind);
      `);
    },
  },
  {
    // v5: bump note_chunks_vec dimension from 1024 to 2048.
    //
    // Why: Zhipu's GLM Embedding-3 returns 2048-dim vectors (Qwen's
    // text-embedding-v3 is 1024-dim, but we standardized on Zhipu for
    // higher quality). The vec0 schema requires the dim at create
    // time, so the only way to change it is DROP + RECREATE. This
    // wipes every existing vec row — run `npm run embed-all` after
    // upgrading to backfill.
    version: 5,
    name: 'vec_dim_2048_for_zhipu_embedding_3',
    up: (db) => {
      // 1. Load sqlite-vec so the vec0 table can be (re)created.
      //    The `up` callback is sync so we can't `await import`; the
      //    top-level import above gives us a sync reference to
      //    `getLoadablePath`.
      let extLoaded = false;
      try {
        db.loadExtension(getLoadablePath());
        extLoaded = true;
      } catch (e) {
        console.warn(
          '[db] v5: failed to load sqlite-vec extension: ' +
            (e instanceof Error ? e.message : String(e)),
        );
      }
      if (!extLoaded) {
        console.warn(
          '[db] v5: skipping note_chunks_vec drop/recreate; ' +
            'vector retrieval will be unavailable until sqlite-vec is loadable',
        );
        return;
      }

      // 2. Drop and recreate with the new dim. Existing vec rows are
      //    intentionally wiped — re-run `npm run embed-all` to refill.
      try {
        db.exec('DROP TABLE IF EXISTS note_chunks_vec;');
      } catch (e) {
        console.warn(
          '[db] v5: failed to drop note_chunks_vec: ' +
            (e instanceof Error ? e.message : String(e)),
        );
      }
      try {
        db.exec(`
          CREATE VIRTUAL TABLE note_chunks_vec USING vec0(
            chunk_id INTEGER PRIMARY KEY,
            embedding float[2048]
          );
        `);
      } catch (e) {
        console.warn(
          '[db] v5: failed to create note_chunks_vec with dim 2048: ' +
            (e instanceof Error ? e.message : String(e)),
        );
      }
    },
  },
  {
    // v6: chat conversation + message persistence.
    //
    // conversations track the chat thread (id, auto-title, timestamps).
    // messages are the individual turns; sources is a nullable JSON array
    // of {id, title} objects. FK CASCADE so deleting a conversation
    // cleans up its messages automatically.
    version: 6,
    name: 'chat_conversations_and_messages',
    up: (db) => {
      db.exec(`
        CREATE TABLE chat_conversations (
          id         TEXT PRIMARY KEY,
          title      TEXT NOT NULL DEFAULT '新对话',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_chat_conv_updated ON chat_conversations(updated_at DESC);

        CREATE TABLE chat_messages (
          id              TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role            TEXT NOT NULL CHECK(role IN ('user','assistant')),
          content         TEXT NOT NULL,
          sources         TEXT,
          created_at      INTEGER NOT NULL,
          FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_chat_msg_conv ON chat_messages(conversation_id, created_at);
      `);
    },
  },
  {
    // v7: hierarchical tags — parent_id + default knowledge-management tags.
    //
    // 1. Add parent_id for parent-child (two-level) tag relationships.
    // 2. Wipe existing user tags and note-tag associations.
    // 3. Seed 5 default top-level tags: 输入, 思考, 输出, 资料, 归档.
    // 4. Reposition 收藏 after the default tags.
    //
    // The 收藏 tag is preserved (never deleted). All other tags are
    // dropped and the note_tags join rows are cleared — this is a
    // deliberate reset to a clean taxonomy.
    version: 7,
    name: 'hierarchical_tags_with_defaults',
    up: (db) => {
      // Schema change
      db.exec(`
        ALTER TABLE tags ADD COLUMN parent_id INTEGER REFERENCES tags(id) ON DELETE SET NULL;
        CREATE INDEX idx_tags_parent ON tags(parent_id);
      `);

      // Data reset
      // Use a raw query — the migration owns the tag name, not user input.
      const favRow = db
        .prepare<[], { id: number }>(
          "SELECT id FROM tags WHERE name = '收藏'",
        )
        .get();

      // Clear all note-tag links
      db.exec('DELETE FROM note_tags;');

      // Delete all tags except 收藏
      if (favRow) {
        db.prepare('DELETE FROM tags WHERE id != ?').run(favRow.id);
      } else {
        db.exec('DELETE FROM tags;');
      }

      // Seed 5 default tags
      const defaults = ['输入', '思考', '输出', '资料', '归档'];
      const insertTag = db.prepare(
        'INSERT INTO tags (name, position, parent_id) VALUES (?, ?, NULL)',
      );
      for (let i = 0; i < defaults.length; i++) {
        insertTag.run(defaults[i], i);
      }

      // Reposition 收藏 to 5 (after the 5 defaults)
      if (favRow) {
        db.prepare('UPDATE tags SET position = ? WHERE id = ?').run(
          5,
          favRow.id,
        );
      } else {
        db.prepare(
          "INSERT INTO tags (name, position, parent_id) VALUES ('收藏', 5, NULL)",
        ).run();
      }
    },
  },
  {
    // v8: switch notes_fts from unicode61 to trigram tokenizer.
    //
    // unicode61 treats consecutive CJK characters as a single token, so
    // queries like "数据库设计" (4 chars) never match notes that contain
    // "数据库" and "设计" as separate phrases. trigram splits every text
    // into overlapping 3-character n-grams, enabling arbitrary Chinese
    // substring search.
    //
    // Steps: drop old fts table + triggers, recreate with trigram,
    // re-insert existing data so the new index is warm immediately.
    version: 8,
    name: 'fts_trigram_tokenizer',
    up: (db) => {
      // 1. Drop old FTS table and triggers.
      db.exec('DROP TABLE IF EXISTS notes_fts;');
      db.exec("DROP TRIGGER IF EXISTS notes_ai;");
      db.exec("DROP TRIGGER IF EXISTS notes_ad;");
      db.exec("DROP TRIGGER IF EXISTS notes_au;");

      // 2. Recreate with trigram tokenizer.
      db.exec(`
        CREATE VIRTUAL TABLE notes_fts USING fts5(
          title,
          content_text,
          content='notes',
          content_rowid='rowid',
          tokenize='trigram'
        );
      `);

      // 3. Re-insert all existing notes so the index is warm.
      db.exec(`
        INSERT INTO notes_fts(rowid, title, content_text)
        SELECT rowid, title, content_text FROM notes;
      `);

      // 4. Recreate triggers to keep fts in sync.
      db.exec(`
        CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts(rowid, title, content_text)
          VALUES (new.rowid, new.title, new.content_text);
        END;
      `);
      db.exec(`
        CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, content_text)
          VALUES ('delete', old.rowid, old.title, old.content_text);
        END;
      `);
      db.exec(`
        CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, content_text)
          VALUES ('delete', old.rowid, old.title, old.content_text);
          INSERT INTO notes_fts(rowid, title, content_text)
          VALUES (new.rowid, new.title, new.content_text);
        END;
      `);
    },
  },
  {
    // v9: agent_actions table for tool-call audit trail + agent tools
    // settings defaults.
    //
    // agent_actions records every tool call invoked from /chat. The
    // result column is plain TEXT (no CHECK constraint) so future
    // action types / result states (e.g. ok_with_embedding_disabled
    // in ticket 01) can land without a schema migration.
    //
    // Settings are INSERT OR IGNORE so re-running migrate() on an
    // already-migrated DB is a no-op.
    version: 9,
    name: 'agent_actions_table',
    up: (db) => {
      db.exec(`
        CREATE TABLE agent_actions (
          id              TEXT PRIMARY KEY,
          conversation_id TEXT,
          action_type     TEXT NOT NULL,
          target_note_id  TEXT,
          params_json     TEXT,
          result          TEXT NOT NULL,
          error_message   TEXT,
          created_at      INTEGER NOT NULL
        );
        CREATE INDEX idx_agent_actions_conv ON agent_actions(conversation_id);
        CREATE INDEX idx_agent_actions_created ON agent_actions(created_at DESC);
      `);

      db.exec(`
        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('agent_tools_enabled', 'false'),
          ('agent_tool_limit', '5');
      `);
    },
  },
];
