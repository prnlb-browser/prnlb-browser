import Database from "better-sqlite3";
import * as path from "node:path";
import type { Actress } from "../core/types.js";

// No foreign key to `downloaded`/`topics` — actresses are a standalone
// catalogue. Cast matching against other tables is done by name lookup at
// the route layer, not by a DB relationship.
const CREATE_ACTRESSES_TABLE = `
  CREATE TABLE IF NOT EXISTS actresses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    otherNames  TEXT NOT NULL DEFAULT '[]',
    postImage   TEXT,
    cachedImage TEXT,
    isFavorite  INTEGER NOT NULL DEFAULT 0,
    createdAt   TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

function normalizeOtherNames(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

type ActressRow = Omit<Actress, "otherNames" | "isFavorite"> & { otherNames: string | null; isFavorite: number };

function decodeRow(row: ActressRow): Actress {
  let otherNames: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.otherNames ?? "[]");
    otherNames = normalizeOtherNames(parsed);
  } catch {
    // Malformed JSON falls back to no aliases.
  }
  return { ...row, otherNames, isFavorite: !!row.isFavorite };
}

export class ActressStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(CREATE_ACTRESSES_TABLE);

    // Idempotent column addition for older schemas (pre-favorites).
    try {
      this.db.exec("ALTER TABLE actresses ADD COLUMN isFavorite INTEGER NOT NULL DEFAULT 0");
    } catch {
      // Column already exists — safe to ignore.
    }
  }

  getAll(): Actress[] {
    const rows = this.db
      .prepare("SELECT * FROM actresses ORDER BY name COLLATE NOCASE ASC")
      .all() as ActressRow[];
    return rows.map(decodeRow);
  }

  getById(id: number): Actress | undefined {
    const row = this.db.prepare("SELECT * FROM actresses WHERE id = ?").get(id) as ActressRow | undefined;
    return row ? decodeRow(row) : undefined;
  }

  // Case-insensitive match against the primary name or any alias — an
  // actress can be credited under several names in a "Cast" string.
  findByName(name: string): Actress | undefined {
    const needle = name.trim().toLowerCase();
    if (!needle) return undefined;
    const rows = this.db.prepare("SELECT * FROM actresses").all() as ActressRow[];
    for (const row of rows) {
      const actress = decodeRow(row);
      if (actress.name.toLowerCase() === needle) return actress;
      if (actress.otherNames.some((n) => n.toLowerCase() === needle)) return actress;
    }
    return undefined;
  }

  insert(item: { name: string; otherNames?: unknown; postImage?: string | null; cachedImage?: string | null; isFavorite?: boolean }): Actress {
    const stmt = this.db.prepare(`
      INSERT INTO actresses (name, otherNames, postImage, cachedImage, isFavorite)
      VALUES (@name, @otherNames, @postImage, @cachedImage, @isFavorite)
    `);
    const result = stmt.run({
      name: item.name.trim(),
      otherNames: JSON.stringify(normalizeOtherNames(item.otherNames)),
      postImage: item.postImage ?? null,
      cachedImage: item.cachedImage ?? null,
      isFavorite: item.isFavorite ? 1 : 0,
    });
    return this.getById(Number(result.lastInsertRowid))!;
  }

  updateItem(
    id: number,
    fields: { name?: string; otherNames?: unknown; postImage?: string | null; cachedImage?: string | null; isFavorite?: boolean },
  ): boolean {
    const sets: string[] = [];
    const values: unknown[] = [];
    if ("name" in fields && fields.name?.trim()) {
      sets.push("name = ?");
      values.push(fields.name.trim());
    }
    if ("otherNames" in fields) {
      sets.push("otherNames = ?");
      values.push(JSON.stringify(normalizeOtherNames(fields.otherNames)));
    }
    if ("postImage" in fields) {
      sets.push("postImage = ?");
      values.push(fields.postImage ?? null);
    }
    if ("cachedImage" in fields) {
      sets.push("cachedImage = ?");
      values.push(fields.cachedImage ?? null);
    }
    if ("isFavorite" in fields) {
      sets.push("isFavorite = ?");
      values.push(fields.isFavorite ? 1 : 0);
    }
    if (sets.length === 0) return false;
    values.push(id);
    return this.db.prepare(`UPDATE actresses SET ${sets.join(", ")} WHERE id = ?`).run(...values).changes > 0;
  }

  // Flips isFavorite and returns the new value, or undefined if no such actress.
  toggleFavorite(id: number): boolean | undefined {
    const existing = this.db.prepare("SELECT isFavorite FROM actresses WHERE id = ?").get(id) as { isFavorite: number } | undefined;
    if (!existing) return undefined;
    const next = existing.isFavorite ? 0 : 1;
    this.db.prepare("UPDATE actresses SET isFavorite = ? WHERE id = ?").run(next, id);
    return !!next;
  }

  deleteById(id: number): boolean {
    return this.db.prepare("DELETE FROM actresses WHERE id = ?").run(id).changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

export function createActressStore(dbPath?: string): ActressStore {
  return new ActressStore(dbPath ?? path.resolve(process.cwd(), "data.db"));
}
