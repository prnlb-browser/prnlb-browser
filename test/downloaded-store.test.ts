import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DownloadedStore } from "../src/downloaded/store.js";

describe("DownloadedStore schema", () => {
  it("creates the downloaded table with cast/date/duration/size columns", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new DownloadedStore(dbPath);
      const item = store.insert({
        fileName: "movie.mp4",
        filePath: "/tmp/movie.mp4",
        title: "Some movie",
        topicUrl: "https://example.com/t=1",
        postImage: null,
        cachedImage: null,
        starring: "Alice, Bob",
        productionDate: "2026",
        duration: "00:30:00",
        size: "1.20 GB",
      });
      assert.equal(item, true);

      const rows = store.getAll();
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.starring, "Alice, Bob");
      assert.equal(rows[0]!.productionDate, "2026");
      assert.equal(rows[0]!.duration, "00:30:00");
      assert.equal(rows[0]!.size, "1.20 GB");
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaults optional columns to null and allows filling them in later", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new DownloadedStore(dbPath);
      store.insert({
        fileName: "old.mp4",
        filePath: "/tmp/old.mp4",
        title: "Old",
        topicUrl: "https://example.com/t=99",
        postImage: null,
        cachedImage: null,
        starring: null,
        productionDate: null,
        duration: null,
        size: null,
      });

      const rows = store.getAll();
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.title, "Old");
      assert.equal(rows[0]!.starring, null);
      assert.equal(rows[0]!.productionDate, null);
      assert.equal(rows[0]!.duration, null);
      assert.equal(rows[0]!.size, null);

      store.updateTopicInfo(rows[0]!.id, "Old (edited)", "https://example.com/t=99", null, null, "Alice", "2025", "01:00:00", "2.00 GB");
      const updated = store.getById(rows[0]!.id);
      assert.equal(updated!.starring, "Alice");
      assert.equal(updated!.productionDate, "2025");
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("updateItem() applies a partial set of fields without touching the rest", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new DownloadedStore(dbPath);
      store.insert({
        fileName: "movie.mp4",
        filePath: "/tmp/movie.mp4",
        title: "Some movie",
        topicUrl: "https://example.com/t=1",
        postImage: null,
        cachedImage: "abc.jpg",
        starring: "Alice",
        productionDate: "2026",
        duration: "00:30:00",
        size: "1.20 GB",
      });
      const id = store.getAll()[0]!.id;

      store.updateItem(id, { starring: "Alice, Bob", duration: "00:42:00" });
      const updated = store.getById(id);

      assert.equal(updated!.starring, "Alice, Bob");
      assert.equal(updated!.duration, "00:42:00");
      // Untouched fields stay the same.
      assert.equal(updated!.productionDate, "2026");
      assert.equal(updated!.size, "1.20 GB");
      assert.equal(updated!.cachedImage, "abc.jpg");
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("updateItem() with an empty payload is a no-op", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new DownloadedStore(dbPath);
      store.insert({
        fileName: "movie.mp4",
        filePath: "/tmp/movie.mp4",
        title: null,
        topicUrl: null,
        postImage: null,
        cachedImage: null,
        starring: null,
        productionDate: null,
        duration: null,
        size: null,
      });
      const id = store.getAll()[0]!.id;
      const ok = store.updateItem(id, {});
      assert.equal(ok, false, "no-op update should report no changes");
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stores tags as a normalized JSON array of {name, color} objects", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new DownloadedStore(dbPath);
      store.insert({
        fileName: "a.mp4",
        filePath: "/tmp/a.mp4",
        title: null,
        topicUrl: null,
        postImage: null,
        cachedImage: null,
        starring: null,
        productionDate: null,
        duration: null,
        size: null,
        // Mix of strings and {name, color} entries to confirm both shapes
        // are accepted; duplicates are deduped case-insensitively.
        tags: ["Favorite", " favorite ", "4k", "", "FAVORITE", { name: "watched", color: "#22c55e" }],
      });
      const row = store.getAll()[0]!;
      assert.deepEqual(row.tags, [
        { name: "Favorite", color: null },
        { name: "4k", color: null },
        { name: "watched", color: "#22c55e" },
      ], "duplicates are case-insensitively de-duped and trimmed, color preserved");
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("updateTags() replaces the tag set and reports via getById", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new DownloadedStore(dbPath);
      store.insert({
        fileName: "b.mp4",
        filePath: "/tmp/b.mp4",
        title: null,
        topicUrl: null,
        postImage: null,
        cachedImage: null,
        starring: null,
        productionDate: null,
        duration: null,
        size: null,
        tags: ["old"],
      });
      const id = store.getAll()[0]!.id;
      const ok = store.updateTags(id, [{ name: "new", color: "#ef4444" }, { name: "queue" }]);
      assert.equal(ok, true);
      const updated = store.getById(id);
      assert.deepEqual(updated!.tags, [
        { name: "new", color: "#ef4444" },
        { name: "queue", color: null },
      ]);
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("updateItem() can replace tags without losing other fields", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new DownloadedStore(dbPath);
      store.insert({
        fileName: "c.mp4",
        filePath: "/tmp/c.mp4",
        title: "Title",
        topicUrl: "https://example.com/t=3",
        postImage: null,
        cachedImage: null,
        starring: "Alice",
        productionDate: "2026",
        duration: "00:30:00",
        size: "1.20 GB",
        tags: ["before"],
      });
      const id = store.getAll()[0]!.id;
      store.updateItem(id, { tags: [{ name: "after", color: "#6366f1" }] });
      const updated = store.getById(id);
      assert.deepEqual(updated!.tags, [{ name: "after", color: "#6366f1" }]);
      assert.equal(updated!.title, "Title");
      assert.equal(updated!.starring, "Alice");
      assert.equal(updated!.size, "1.20 GB");
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("getAllTags() returns deduplicated DownloadedTag objects sorted by name", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new DownloadedStore(dbPath);
      store.insert({
        fileName: "d.mp4", filePath: "/tmp/d.mp4",
        title: null, topicUrl: null, postImage: null, cachedImage: null,
        starring: null, productionDate: null, duration: null, size: null,
        tags: [{ name: "favorite", color: null }, { name: "queue", color: null }],
      });
      store.insert({
        fileName: "e.mp4", filePath: "/tmp/e.mp4",
        title: null, topicUrl: null, postImage: null, cachedImage: null,
        starring: null, productionDate: null, duration: null, size: null,
        tags: [{ name: "Favorite", color: null }, { name: "4k", color: "#3b82f6" }],
      });
      store.insert({
        fileName: "f.mp4", filePath: "/tmp/f.mp4",
        title: null, topicUrl: null, postImage: null, cachedImage: null,
        starring: null, productionDate: null, duration: null, size: null,
        tags: [],
      });
      const all = store.getAllTags();
      // Case-insensitive dedup; the first-encountered casing wins, and the
      // color from any later occurrence backfills a null.
      assert.deepEqual(all, [
        { name: "4k", color: "#3b82f6" },
        { name: "favorite", color: null },
        { name: "queue", color: null },
      ]);
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects malformed CSS colors but keeps the tag itself", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new DownloadedStore(dbPath);
      store.insert({
        fileName: "g.mp4", filePath: "/tmp/g.mp4",
        title: null, topicUrl: null, postImage: null, cachedImage: null,
        starring: null, productionDate: null, duration: null, size: null,
        // 'javascript:alert(1)' is a classic injection attempt; '#ggg' is
        // just invalid. Both must be silently dropped while the name remains.
        tags: [{ name: "safe", color: "#22c55e" }, { name: "evil", color: "javascript:alert(1)" }, { name: "bad-hex", color: "#ggg" }],
      });
      const row = store.getAll()[0]!;
      assert.deepEqual(row.tags, [
        { name: "safe", color: "#22c55e" },
        { name: "evil", color: null },
        { name: "bad-hex", color: null },
      ]);
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("decodes malformed tag JSON safely to an empty array", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      // Seed a row with a deliberately malformed tags column to simulate
      // legacy or corrupted data.
      const Database = require("better-sqlite3");
      const db = new Database(dbPath);
      db.exec(
        "CREATE TABLE downloaded (id INTEGER PRIMARY KEY AUTOINCREMENT, fileName TEXT NOT NULL, filePath TEXT NOT NULL UNIQUE, tags TEXT NOT NULL DEFAULT '[]', createdAt TEXT NOT NULL DEFAULT (datetime('now')))",
      );
      db.prepare("INSERT INTO downloaded (fileName, filePath, tags) VALUES (?, ?, ?)").run(
        "legacy.mp4", "/tmp/legacy.mp4", "not-json",
      );
      db.close();

      const store = new DownloadedStore(dbPath);
      const row = store.getAll()[0]!;
      assert.deepEqual(row.tags, [], "malformed tag JSON falls back to []");
      assert.deepEqual(store.getAllTags(), []);
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
