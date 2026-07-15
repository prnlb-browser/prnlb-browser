import Database from "better-sqlite3";
import * as path from "node:path";
import type { DownloadedItem, DownloadedTag } from "../core/types.js";
import { normalizeTags, decodeTags, mergeTagLists } from "../core/tags.js";

const CREATE_DOWNLOADED_TABLE = `
  CREATE TABLE IF NOT EXISTS downloaded (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    fileName        TEXT NOT NULL,
    filePath        TEXT NOT NULL UNIQUE,
    title           TEXT,
    topicUrl        TEXT,
    postImage       TEXT,
    cachedImage     TEXT,
    starring        TEXT,
    productionDate  TEXT,
    duration        TEXT,
    size            TEXT,
    tags            TEXT NOT NULL DEFAULT '[]',
    createdAt       TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

export class DownloadedStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(CREATE_DOWNLOADED_TABLE);
  }

  clearAll(): number {
    return this.db.prepare("DELETE FROM downloaded").run().changes;
  }

  getAll(): DownloadedItem[] {
    const rows = this.db
      .prepare("SELECT * FROM downloaded ORDER BY createdAt DESC")
      .all() as Array<Omit<DownloadedItem, "tags"> & { tags: string | null }>;
    return rows.map((row) => ({ ...row, tags: decodeTags(row.tags) }));
  }

  insert(item: Omit<DownloadedItem, "id" | "createdAt">): boolean {
    const tagsJson = JSON.stringify(normalizeTags(item.tags));
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO downloaded
        (fileName, filePath, title, topicUrl, postImage, cachedImage, starring, productionDate, duration, size, tags)
      VALUES
        (@fileName, @filePath, @title, @topicUrl, @postImage, @cachedImage, @starring, @productionDate, @duration, @size, @tags)
    `);
    return stmt.run({ ...item, tags: tagsJson }).changes > 0;
  }

  exists(filePath: string): boolean {
    return this.db.prepare("SELECT 1 FROM downloaded WHERE filePath = ? LIMIT 1").get(filePath) !== undefined;
  }

  updateTopicInfo(
    id: number,
    title: string | null,
    topicUrl: string | null,
    postImage: string | null,
    cachedImage: string | null,
    starring: string | null,
    productionDate: string | null,
    duration: string | null,
    size: string | null,
  ): boolean {
    return this.db.prepare(
      `UPDATE downloaded
       SET title = ?, topicUrl = ?, postImage = ?, cachedImage = ?,
           starring = ?, productionDate = ?, duration = ?, size = ?
       WHERE id = ?`,
    ).run(title, topicUrl, postImage, cachedImage, starring, productionDate, duration, size, id).changes > 0;
  }

  updateItem(
    id: number,
    fields: {
      title?: string | null;
      topicUrl?: string | null;
      postImage?: string | null;
      cachedImage?: string | null;
      starring?: string | null;
      productionDate?: string | null;
      duration?: string | null;
      size?: string | null;
      tags?: unknown;
    },
  ): boolean {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const key of ["title", "topicUrl", "postImage", "cachedImage", "starring", "productionDate", "duration", "size"] as const) {
      if (key in fields) {
        sets.push(`${key} = ?`);
        values.push((fields as Record<string, unknown>)[key] ?? null);
      }
    }
    if ("tags" in fields) {
      sets.push("tags = ?");
      values.push(JSON.stringify(normalizeTags(fields.tags ?? null)));
    }
    if (sets.length === 0) return false;
    values.push(id);
    return this.db.prepare(`UPDATE downloaded SET ${sets.join(", ")} WHERE id = ?`).run(...values).changes > 0;
  }

  updateTags(id: number, tags: unknown): boolean {
    return this.db
      .prepare("UPDATE downloaded SET tags = ? WHERE id = ?")
      .run(JSON.stringify(normalizeTags(tags)), id).changes > 0;
  }

  getAllTags(): DownloadedTag[] {
    const rows = this.db.prepare("SELECT tags FROM downloaded WHERE tags IS NOT NULL AND tags != ''").all() as { tags: string }[];
    return mergeTagLists(...rows.map((row) => decodeTags(row.tags)));
  }

  getById(id: number): DownloadedItem | undefined {
    const row = this.db
      .prepare("SELECT * FROM downloaded WHERE id = ?")
      .get(id) as Array<Omit<DownloadedItem, "tags"> & { tags: string | null }>[number] | undefined;
    if (!row) return undefined;
    return { ...row, tags: decodeTags(row.tags) };
  }

  deleteById(id: number): boolean {
    return this.db.prepare("DELETE FROM downloaded WHERE id = ?").run(id).changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

export function createDownloadedStore(dbPath?: string): DownloadedStore {
  return new DownloadedStore(dbPath ?? path.resolve(process.cwd(), "data.db"));
}
