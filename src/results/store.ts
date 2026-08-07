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
    aiRating  REAL,
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

export interface TopicSort {
  by?: "createdAt" | "aiRating" | "size" | "starring";
  dir?: "asc" | "desc";
}

const SORT_FIELDS = new Set<NonNullable<TopicSort["by"]>>(["createdAt", "aiRating", "size", "starring"]);

// "size" is a human-readable string scraped from the forum (e.g. "1.36 GB"),
// so it can't be sorted correctly as text — parse it to bytes first.
function sizeToBytes(size: string | null | undefined): number | null {
  if (!size) return null;
  const match = size.match(/^([\d.,]+)\s*([KMGT]?B)$/i);
  if (!match) return null;
  const value = parseFloat(match[1]!.replace(",", "."));
  if (Number.isNaN(value)) return null;
  const multipliers: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return value * (multipliers[match[2]!.toUpperCase()] ?? 1);
}

// Sorting happens in JS rather than SQL — "size" needs byte-parsing (see
// above), so all fields are sorted here for one consistent code path.
// Nulls/empty values sort last regardless of direction, same convention as
// the Downloaded tab's sort comparator.
function sortTopics(rows: TopicData[], sort?: TopicSort): TopicData[] {
  const by = sort?.by && SORT_FIELDS.has(sort.by) ? sort.by : "createdAt";
  const dir = sort?.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = by === "size" ? sizeToBytes(a.size) : (a as unknown as Record<string, unknown>)[by];
    const bv = by === "size" ? sizeToBytes(b.size) : (b as unknown as Record<string, unknown>)[by];
    const aNull = av === null || av === undefined || av === "";
    const bNull = bv === null || bv === undefined || bv === "";
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * dir;
  });
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

    // Idempotent column addition for older schemas (pre-AI-rating).
    try {
      this.db.exec("ALTER TABLE topics ADD COLUMN aiRating REAL");
    } catch {
      // Column already exists — safe to ignore.
    }
  }

  insert(topic: TopicData): boolean {
    const tagsJson = JSON.stringify(normalizeTags(topic.tags));
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO topics (topicUrl, title, postImage, starring, productionDate, duration, size, torrentUrl, sourceForum, hidden, tags, aiRating)
      VALUES (@topicUrl, @title, @postImage, @starring, @productionDate, @duration, @size, @torrentUrl, @sourceForum, @hidden, @tags, @aiRating)
    `);
    return stmt.run({ ...topic, tags: tagsJson, aiRating: topic.aiRating ?? null }).changes > 0;
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

  setAiRating(topicUrl: string, rating: number | null): boolean {
    return this.db.prepare("UPDATE topics SET aiRating = ? WHERE topicUrl = ?").run(rating, topicUrl).changes > 0;
  }

  clearAllAiRatings(): number {
    return this.db.prepare("UPDATE topics SET aiRating = NULL WHERE aiRating IS NOT NULL").run().changes;
  }

  getAllTags(): ReturnType<typeof mergeTagLists> {
    const rows = this.db.prepare("SELECT tags FROM topics WHERE tags IS NOT NULL AND tags != ''").all() as { tags: string }[];
    return mergeTagLists(...rows.map((row) => decodeTags(row.tags)));
  }

  getAll(sort?: TopicSort): TopicData[] {
    const rows = this.db.prepare(`SELECT * FROM topics`).all() as TopicRow[];
    return sortTopics(rows.map(decodeRow), sort);
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) as cnt FROM topics").get() as { cnt: number }).cnt;
  }

  search(query: string, sort?: TopicSort): TopicData[] {
    const rows = this.db
      .prepare(`SELECT * FROM topics WHERE title LIKE ?`)
      .all(`%${query}%`) as TopicRow[];
    return sortTopics(rows.map(decodeRow), sort);
  }

  searchByForum(query: string, sourceForum: string, sort?: TopicSort): TopicData[] {
    const rows = this.db.prepare(
      `SELECT * FROM topics WHERE title LIKE ? AND sourceForum = ?`,
    ).all(`%${query}%`, sourceForum) as TopicRow[];
    return sortTopics(rows.map(decodeRow), sort);
  }

  getByForum(sourceForum: string, sort?: TopicSort): TopicData[] {
    const rows = this.db
      .prepare(`SELECT * FROM topics WHERE sourceForum = ?`)
      .all(sourceForum) as TopicRow[];
    return sortTopics(rows.map(decodeRow), sort);
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

  setHidden(topicUrl: string, hidden: boolean): boolean {
    return this.db.prepare("UPDATE topics SET hidden = ? WHERE topicUrl = ?").run(hidden ? 1 : 0, topicUrl).changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

export function createTopicStore(dbPath?: string): TopicStore {
  return new TopicStore(dbPath ?? path.resolve(process.cwd(), "data.db"));
}
