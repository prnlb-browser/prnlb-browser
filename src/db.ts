import Database from "better-sqlite3";
import * as path from "node:path";
import type { TopicData } from "./types.js";

// --- Schema ---

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
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

const CREATE_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_topics_title ON topics(title)
`;

// --- DB wrapper ---

export class TopicStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(CREATE_TABLE);
    this.db.exec(CREATE_INDEX);
  }

  /** Insert a topic. Returns true if inserted, false if it already existed. */
  insert(topic: TopicData): boolean {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO topics (topicUrl, title, postImage, starring, productionDate, duration, size, torrentUrl, sourceForum, hidden)
      VALUES (@topicUrl, @title, @postImage, @starring, @productionDate, @duration, @size, @torrentUrl, @sourceForum, @hidden)
    `);
    const result = stmt.run(topic);
    return result.changes > 0;
  }

  /** Check if a topic URL already exists */
  exists(topicUrl: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM topics WHERE topicUrl = ? LIMIT 1"
    ).get(topicUrl);
    return row !== undefined;
  }

  /** Bulk insert — inserts new topics, skips existing ones. Returns counts. */
  insertMany(topics: TopicData[]): { inserted: number; skipped: number } {
    let inserted = 0;
    let skipped = 0;

    const tx = this.db.transaction((items: TopicData[]) => {
      for (const topic of items) {
        if (this.insert(topic)) {
          inserted++;
        } else {
          skipped++;
        }
      }
    });
    tx(topics);
    return { inserted, skipped };
  }

  /** Delete all topics from the database */
  clearAll(): number {
    const result = this.db.prepare("DELETE FROM topics").run();
    return result.changes;
  }

  /** Get all topics (newest first) */
  getAll(): TopicData[] {
    return this.db.prepare(
      "SELECT * FROM topics ORDER BY createdAt DESC"
    ).all() as TopicData[];
  }

  /** Get topic count */
  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM topics").get() as { cnt: number };
    return row.cnt;
  }

  /** Search topics by title */
  search(query: string): TopicData[] {
    return this.db.prepare(
      "SELECT * FROM topics WHERE title LIKE ? ORDER BY createdAt DESC"
    ).all(`%${query}%`) as TopicData[];
  }

  /** Search topics by title, filtered by source forum */
  searchByForum(query: string, sourceForum: string): TopicData[] {
    return this.db.prepare(
      "SELECT * FROM topics WHERE title LIKE ? AND sourceForum = ? ORDER BY createdAt DESC"
    ).all(`%${query}%`, sourceForum) as TopicData[];
  }

  /** Get all topics filtered by source forum */
  getByForum(sourceForum: string): TopicData[] {
    return this.db.prepare(
      "SELECT * FROM topics WHERE sourceForum = ? ORDER BY createdAt DESC"
    ).all(sourceForum) as TopicData[];
  }

  /** Get distinct source forum labels that have results in DB */
  getDistinctForums(): string[] {
    const rows = this.db.prepare(
      "SELECT DISTINCT sourceForum FROM topics WHERE sourceForum IS NOT NULL ORDER BY sourceForum"
    ).all() as { sourceForum: string }[];
    return rows.map((r) => r.sourceForum);
  }

  /** Get a single topic by URL */
  getByUrl(topicUrl: string): TopicData | undefined {
    return this.db.prepare(
      "SELECT * FROM topics WHERE topicUrl = ?"
    ).get(topicUrl) as TopicData | undefined;
  }

  /** Toggle the hidden flag for a topic. Returns the new hidden state (0 or 1). */
  toggleHidden(topicUrl: string): number {
    const existing = this.db.prepare(
      "SELECT hidden FROM topics WHERE topicUrl = ?"
    ).get(topicUrl) as { hidden: number } | undefined;
    if (!existing) return 0;
    const newVal = existing.hidden ? 0 : 1;
    this.db.prepare(
      "UPDATE topics SET hidden = ? WHERE topicUrl = ?"
    ).run(newVal, topicUrl);
    return newVal;
  }

  close(): void {
    this.db.close();
  }
}

// --- Factory ---

export function createTopicStore(dbPath?: string): TopicStore {
  const resolved = dbPath ?? path.resolve(process.cwd(), "data.db");
  return new TopicStore(resolved);
}
