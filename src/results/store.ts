import Database from "better-sqlite3";
import * as path from "node:path";
import type { TopicData } from "../core/types.js";
import { normalizeTags, decodeTags, mergeTagLists } from "../core/tags.js";

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS topics (
    topicUrl  TEXT PRIMARY KEY,
    title     TEXT NOT NULL,
    postImage TEXT,
    starring  TEXT,
    productionDate TEXT,
    duration  TEXT,
    size      TEXT,
    torrentUrl TEXT,
    sourceForum TEXT,
    hidden    INTEGER NOT NULL DEFAULT 0,
    tags      TEXT NOT NULL DEFAULT '[]',
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

const CREATE_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_topics_title ON topics(title)
`;

type TopicRow = Omit<TopicData, "tags"> & { tags: string | null };

function decodeRow(row: TopicRow): TopicData {
  return { ...row, tags: decodeTags(row.tags) };
}

export class TopicStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(CREATE_TABLE);
    this.db.exec(CREATE_INDEX);

    // Idempotent column addition for older schemas (pre-tags).
    try {
      this.db.exec("ALTER TABLE topics ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
    } catch {
      // Column already exists — safe to ignore.
    }
  }

  insert(topic: TopicData): boolean {
    const tagsJson = JSON.stringify(normalizeTags(topic.tags));
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO topics (topicUrl, title, postImage, starring, productionDate, duration, size, torrentUrl, sourceForum, hidden, tags)
      VALUES (@topicUrl, @title, @postImage, @starring, @productionDate, @duration, @size, @torrentUrl, @sourceForum, @hidden, @tags)
    `);
    return stmt.run({ ...topic, tags: tagsJson }).changes > 0;
  }

  exists(topicUrl: string): boolean {
    return this.db.prepare("SELECT 1 FROM topics WHERE topicUrl = ? LIMIT 1").get(topicUrl) !== undefined;
  }

  insertMany(topics: TopicData[]): { inserted: number; skipped: number } {
    let inserted = 0;
    let skipped = 0;
    const tx = this.db.transaction((items: TopicData[]) => {
      for (const topic of items) {
        if (this.insert(topic)) inserted++;
        else skipped++;
      }
    });
    tx(topics);
    return { inserted, skipped };
  }

  clearAll(): number {
    return this.db.prepare("DELETE FROM topics").run().changes;
  }

  deleteByUrl(topicUrl: string): boolean {
    return this.db.prepare("DELETE FROM topics WHERE topicUrl = ?").run(topicUrl).changes > 0;
  }

  updateDetails(topicUrl: string, details: { postImage: string | null; starring: string | null; productionDate: string | null; duration: string | null }): boolean {
    return this.db.prepare(
      "UPDATE topics SET postImage = ?, starring = ?, productionDate = ?, duration = ? WHERE topicUrl = ?",
    ).run(details.postImage, details.starring, details.productionDate, details.duration, topicUrl).changes > 0;
  }

  updateItem(topicUrl: string, fields: Partial<Pick<TopicData, "title" | "postImage" | "starring" | "productionDate" | "duration" | "size">>): boolean {
    const keys = Object.keys(fields);
    if (keys.length === 0) return false;
    const sets = keys.map((key) => `${key} = ?`).join(", ");
    const values = keys.map((key) => (fields as Record<string, unknown>)[key]);
    return this.db.prepare(`UPDATE topics SET ${sets} WHERE topicUrl = ?`).run(...values, topicUrl).changes > 0;
  }

  updateTags(topicUrl: string, tags: unknown): boolean {
    return this.db
      .prepare("UPDATE topics SET tags = ? WHERE topicUrl = ?")
      .run(JSON.stringify(normalizeTags(tags)), topicUrl).changes > 0;
  }

  getAllTags(): ReturnType<typeof mergeTagLists> {
    const rows = this.db.prepare("SELECT tags FROM topics WHERE tags IS NOT NULL AND tags != ''").all() as { tags: string }[];
    return mergeTagLists(...rows.map((row) => decodeTags(row.tags)));
  }

  getAll(): TopicData[] {
    const rows = this.db.prepare("SELECT * FROM topics ORDER BY createdAt DESC").all() as TopicRow[];
    return rows.map(decodeRow);
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) as cnt FROM topics").get() as { cnt: number }).cnt;
  }

  search(query: string): TopicData[] {
    const rows = this.db.prepare("SELECT * FROM topics WHERE title LIKE ? ORDER BY createdAt DESC").all(`%${query}%`) as TopicRow[];
    return rows.map(decodeRow);
  }

  searchByForum(query: string, sourceForum: string): TopicData[] {
    const rows = this.db.prepare(
      "SELECT * FROM topics WHERE title LIKE ? AND sourceForum = ? ORDER BY createdAt DESC",
    ).all(`%${query}%`, sourceForum) as TopicRow[];
    return rows.map(decodeRow);
  }

  getByForum(sourceForum: string): TopicData[] {
    const rows = this.db.prepare("SELECT * FROM topics WHERE sourceForum = ? ORDER BY createdAt DESC").all(sourceForum) as TopicRow[];
    return rows.map(decodeRow);
  }

  getDistinctForums(): string[] {
    const rows = this.db.prepare(
      "SELECT DISTINCT sourceForum FROM topics WHERE sourceForum IS NOT NULL ORDER BY sourceForum",
    ).all() as { sourceForum: string }[];
    return rows.map((row) => row.sourceForum);
  }

  getByUrl(topicUrl: string): TopicData | undefined {
    const row = this.db.prepare("SELECT * FROM topics WHERE topicUrl = ?").get(topicUrl) as TopicRow | undefined;
    return row ? decodeRow(row) : undefined;
  }

  toggleHidden(topicUrl: string): number {
    const existing = this.db.prepare("SELECT hidden FROM topics WHERE topicUrl = ?").get(topicUrl) as { hidden: number } | undefined;
    if (!existing) return 0;
    const hidden = existing.hidden ? 0 : 1;
    this.db.prepare("UPDATE topics SET hidden = ? WHERE topicUrl = ?").run(hidden, topicUrl);
    return hidden;
  }

  close(): void {
    this.db.close();
  }
}

export function createTopicStore(dbPath?: string): TopicStore {
  return new TopicStore(dbPath ?? path.resolve(process.cwd(), "data.db"));
}
