import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TopicStore } from "../src/results/store.js";

function baseTopic(topicUrl: string, title: string) {
  return {
    topicUrl, title, postImage: null, starring: null, productionDate: null,
    duration: null, size: null, torrentUrl: null, sourceForum: null, hidden: 0,
  };
}

describe("TopicStore tags", () => {
  it("stores tags as a normalized JSON array of {name, color} objects", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-results-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new TopicStore(dbPath);
      store.insert({
        ...baseTopic("u1", "A"),
        tags: ["Favorite", " favorite ", "4k", "", "FAVORITE", { name: "watched", color: "#22c55e" }],
      });
      const row = store.getAll()[0]!;
      assert.deepEqual(row.tags, [
        { name: "Favorite", color: null },
        { name: "4k", color: null },
        { name: "watched", color: "#22c55e" },
      ]);
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("updateTags() replaces the tag set and reports via getByUrl", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-results-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new TopicStore(dbPath);
      store.insert({ ...baseTopic("u1", "A"), tags: ["old"] });
      const ok = store.updateTags("u1", [{ name: "new", color: "#ef4444" }, { name: "queue" }]);
      assert.equal(ok, true);
      const updated = store.getByUrl("u1");
      assert.deepEqual(updated!.tags, [
        { name: "new", color: "#ef4444" },
        { name: "queue", color: null },
      ]);
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("getAllTags() returns deduplicated tag objects sorted by name", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-results-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new TopicStore(dbPath);
      store.insert({ ...baseTopic("u1", "A"), tags: [{ name: "favorite", color: null }, { name: "queue", color: null }] });
      store.insert({ ...baseTopic("u2", "B"), tags: [{ name: "Favorite", color: null }, { name: "4k", color: "#3b82f6" }] });
      store.insert({ ...baseTopic("u3", "C"), tags: [] });
      const all = store.getAllTags();
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

  it("decodes tags on search/searchByForum/getByForum too", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-results-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new TopicStore(dbPath);
      store.insert({ ...baseTopic("u1", "Alpha"), sourceForum: "forumA", tags: [{ name: "favorite", color: "#22c55e" }] });
      assert.deepEqual(store.search("Alpha")[0]!.tags, [{ name: "favorite", color: "#22c55e" }]);
      assert.deepEqual(store.searchByForum("Alpha", "forumA")[0]!.tags, [{ name: "favorite", color: "#22c55e" }]);
      assert.deepEqual(store.getByForum("forumA")[0]!.tags, [{ name: "favorite", color: "#22c55e" }]);
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("migrates an older topics table (no tags column) without losing rows", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-results-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const Database = require("better-sqlite3");
      const db = new Database(dbPath);
      db.exec(
        "CREATE TABLE topics (topicUrl TEXT PRIMARY KEY, title TEXT NOT NULL, postImage TEXT, starring TEXT, productionDate TEXT, duration TEXT, size TEXT, torrentUrl TEXT, sourceForum TEXT, hidden INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL DEFAULT (datetime('now')))",
      );
      db.prepare(
        "INSERT INTO topics (topicUrl, title, hidden) VALUES (?, ?, ?)",
      ).run("legacy-url", "Legacy", 0);
      db.close();

      const store = new TopicStore(dbPath);
      const rows = store.getAll();
      assert.equal(rows.length, 1, "legacy row must survive schema migration");
      assert.equal(rows[0]!.title, "Legacy");
      assert.deepEqual(rows[0]!.tags, [], "tags column defaults to an empty array");
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
