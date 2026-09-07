import Database from "better-sqlite3";
import * as path from "node:path";
import type { Actress, ActressGroup } from "../core/types.js";

// No foreign key to `downloaded`/`topics` — actresses are a standalone
// catalogue. Cast matching against other tables is done by name lookup at
// the route layer, not by a DB relationship.
const CREATE_GROUPS_TABLE = `
  CREATE TABLE IF NOT EXISTS actressGroups (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    isDefault INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

const CREATE_ACTRESSES_TABLE = `
  CREATE TABLE IF NOT EXISTS actresses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    otherNames  TEXT NOT NULL DEFAULT '[]',
    postImage   TEXT,
    cachedImage TEXT,
    isFavorite  INTEGER NOT NULL DEFAULT 0,
    groupId     INTEGER,
    createdAt   TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

const DEFAULT_GROUP_NAME = "Default";

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

type ActressRow = Omit<Actress, "otherNames" | "isFavorite" | "groupId"> & {
  otherNames: string | null;
  isFavorite: number;
  groupId: number | null;
};
type ActressGroupRow = Omit<ActressGroup, "isDefault"> & { isDefault: number };

function decodeGroup(row: ActressGroupRow): ActressGroup {
  return { ...row, isDefault: !!row.isDefault };
}

function decodeRow(row: ActressRow, defaultGroupId: number): Actress {
  let otherNames: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.otherNames ?? "[]");
    otherNames = normalizeOtherNames(parsed);
  } catch {
    // Malformed JSON falls back to no aliases.
  }
  return { ...row, otherNames, isFavorite: !!row.isFavorite, groupId: row.groupId ?? defaultGroupId };
}

export class ActressStore {
  private db: Database.Database;
  private defaultGroupId: number;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(CREATE_GROUPS_TABLE);
    this.db.prepare("INSERT INTO actressGroups (name, isDefault) SELECT ?, 1 WHERE NOT EXISTS (SELECT 1 FROM actressGroups WHERE isDefault = 1)").run(DEFAULT_GROUP_NAME);
    const defaultGroup = this.db.prepare("SELECT id FROM actressGroups WHERE isDefault = 1 ORDER BY id LIMIT 1").get() as { id: number } | undefined;
    if (!defaultGroup) throw new Error("Failed to initialize the default actress group");
    this.defaultGroupId = defaultGroup.id;
    this.db.exec(CREATE_ACTRESSES_TABLE);

    // Idempotent column addition for older schemas (pre-favorites).
    try {
      this.db.exec("ALTER TABLE actresses ADD COLUMN isFavorite INTEGER NOT NULL DEFAULT 0");
    } catch {
      // Column already exists — safe to ignore.
    }

    // Idempotent column addition for existing catalogues (pre-grouping).
    try {
      this.db.exec("ALTER TABLE actresses ADD COLUMN groupId INTEGER");
    } catch {
      // Column already exists — safe to ignore.
    }
    this.db.prepare("UPDATE actresses SET groupId = ? WHERE groupId IS NULL").run(this.defaultGroupId);
  }

  getAll(): Actress[] {
    const rows = this.db
      .prepare("SELECT * FROM actresses ORDER BY name COLLATE NOCASE ASC")
      .all() as ActressRow[];
    return rows.map((row) => decodeRow(row, this.defaultGroupId));
  }

  getById(id: number): Actress | undefined {
    const row = this.db.prepare("SELECT * FROM actresses WHERE id = ?").get(id) as ActressRow | undefined;
    return row ? decodeRow(row, this.defaultGroupId) : undefined;
  }

  getGroups(): ActressGroup[] {
    const rows = this.db
      .prepare("SELECT * FROM actressGroups ORDER BY CASE WHEN isDefault = 1 THEN 0 ELSE 1 END, name COLLATE NOCASE ASC")
      .all() as ActressGroupRow[];
    return rows.map(decodeGroup);
  }

  getGroupById(id: number): ActressGroup | undefined {
    const row = this.db.prepare("SELECT * FROM actressGroups WHERE id = ?").get(id) as ActressGroupRow | undefined;
    return row ? decodeGroup(row) : undefined;
  }

  insertGroup(name: string): ActressGroup {
    const normalizedName = name.trim();
    if (!normalizedName) throw new RangeError("Group name is required");
    const duplicate = this.db.prepare("SELECT id FROM actressGroups WHERE name = ? COLLATE NOCASE").get(normalizedName);
    if (duplicate) throw new Error("A group with this name already exists");
    const result = this.db.prepare("INSERT INTO actressGroups (name, isDefault) VALUES (?, 0)").run(normalizedName);
    return this.getGroupById(Number(result.lastInsertRowid))!;
  }

  updateGroup(id: number, name: string): boolean {
    const normalizedName = name.trim();
    if (!normalizedName) throw new RangeError("Group name is required");
    if (!this.getGroupById(id)) return false;
    const duplicate = this.db
      .prepare("SELECT id FROM actressGroups WHERE name = ? COLLATE NOCASE AND id != ?")
      .get(normalizedName, id);
    if (duplicate) throw new Error("A group with this name already exists");
    return this.db.prepare("UPDATE actressGroups SET name = ? WHERE id = ?").run(normalizedName, id).changes > 0;
  }

  deleteGroup(id: number): boolean {
    const group = this.getGroupById(id);
    if (!group || group.isDefault) return false;
    const transaction = this.db.transaction(() => {
      this.db.prepare("UPDATE actresses SET groupId = ? WHERE groupId = ?").run(this.defaultGroupId, id);
      return this.db.prepare("DELETE FROM actressGroups WHERE id = ?").run(id).changes > 0;
    });
    return transaction();
  }

  // Case-insensitive match against the primary name or any alias — an
  // actress can be credited under several names in a "Cast" string.
  findByName(name: string): Actress | undefined {
    const needle = name.trim().toLowerCase();
    if (!needle) return undefined;
    const rows = this.db.prepare("SELECT * FROM actresses").all() as ActressRow[];
    for (const row of rows) {
      const actress = decodeRow(row, this.defaultGroupId);
      if (actress.name.toLowerCase() === needle) return actress;
      if (actress.otherNames.some((n) => n.toLowerCase() === needle)) return actress;
    }
    return undefined;
  }

  insert(item: { name: string; otherNames?: unknown; postImage?: string | null; cachedImage?: string | null; isFavorite?: boolean; groupId?: number }): Actress {
    const groupId = item.groupId ?? this.defaultGroupId;
    if (!this.getGroupById(groupId)) throw new Error("Group not found");
    const stmt = this.db.prepare(`
      INSERT INTO actresses (name, otherNames, postImage, cachedImage, isFavorite, groupId)
      VALUES (@name, @otherNames, @postImage, @cachedImage, @isFavorite, @groupId)
    `);
    const result = stmt.run({
      name: item.name.trim(),
      otherNames: JSON.stringify(normalizeOtherNames(item.otherNames)),
      postImage: item.postImage ?? null,
      cachedImage: item.cachedImage ?? null,
      isFavorite: item.isFavorite ? 1 : 0,
      groupId,
    });
    return this.getById(Number(result.lastInsertRowid))!;
  }

  updateItem(
    id: number,
    fields: { name?: string; otherNames?: unknown; postImage?: string | null; cachedImage?: string | null; isFavorite?: boolean; groupId?: number },
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
    if ("groupId" in fields) {
      if (!this.getGroupById(fields.groupId!)) throw new Error("Group not found");
      sets.push("groupId = ?");
      values.push(fields.groupId);
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
