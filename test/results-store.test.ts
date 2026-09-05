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
        comments: "AI should compare this item with the downloaded copy.",
        tags: ["Favorite", " favorite ", "4k", "", "FAVORITE", { name: "watched", color: "#22c55e" }],
      });
      const row = store.getAll()[0]!;
      assert.equal(row.comments, "AI should compare this item with the downloaded copy.");
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

  it("persists and updates comments without affecting other fields", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-results-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new TopicStore(dbPath);
      store.insert({ ...baseTopic("u1", "A"), comments: "Initial context" });
      assert.equal(store.getByUrl("u1")!.comments, "Initial context");
      assert.equal(store.updateItem("u1", { comments: "Updated context" }), true);
      assert.equal(store.getByUrl("u1")!.comments, "Updated context");
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

describe("TopicStore rates", () => {
  it("defaults to null and can be set/read via setRating/getByUrl", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-results-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new TopicStore(dbPath);
      store.insert(baseTopic("u1", "A"));
      assert.equal(store.getByUrl("u1")!.aiRating, null);

      const ok = store.setRating("u1", 72);
      assert.equal(ok, true);
      assert.equal(store.getByUrl("u1")!.aiRating, 72);

      store.setRating("u1", null);
      assert.equal(store.getByUrl("u1")!.aiRating, null);

      assert.equal(store.setRating("missing-url", 10), false);
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("migrates an older topics table (no aiRating column) without losing rows", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-results-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const Database = require("better-sqlite3");
      const db = new Database(dbPath);
      db.exec(
        "CREATE TABLE topics (topicUrl TEXT PRIMARY KEY, title TEXT NOT NULL, postImage TEXT, starring TEXT, productionDate TEXT, duration TEXT, size TEXT, torrentUrl TEXT, sourceForum TEXT, hidden INTEGER NOT NULL DEFAULT 0, tags TEXT NOT NULL DEFAULT '[]', createdAt TEXT NOT NULL DEFAULT (datetime('now')))",
      );
      db.prepare("INSERT INTO topics (topicUrl, title, hidden) VALUES (?, ?, ?)").run("legacy-url", "Legacy", 0);
      db.close();

      const store = new TopicStore(dbPath);
      const rows = store.getAll();
      assert.equal(rows.length, 1, "legacy row must survive schema migration");
      assert.equal(rows[0]!.aiRating, null, "aiRating column defaults to null");
      assert.equal(store.setRating("legacy-url", 40), true);
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("TopicStore visibility", () => {
  it("sets a topic hidden or visible and reports missing topics", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-results-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new TopicStore(dbPath);
      store.insert(baseTopic("u1", "A"));

      assert.equal(store.setHidden("u1", true), true);
      assert.equal(store.getByUrl("u1")!.hidden, 1);
      assert.equal(store.setHidden("u1", false), true);
      assert.equal(store.getByUrl("u1")!.hidden, 0);
      assert.equal(store.setHidden("missing-url", true), false);

      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("TopicStore sort", () => {
  it("getAll() defaults to createdAt DESC when no sort is given", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-results-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new TopicStore(dbPath);
      store.insert(baseTopic("u1", "First"));
      store.insert(baseTopic("u2", "Second"));
      // `createdAt` has second-level resolution (`datetime('now')`), so two
      // inserts in the same test can land in the same second — set explicit,
      // distinct timestamps directly so DESC order is deterministic here.
      const Database = require("better-sqlite3");
      const raw = new Database(dbPath);
      raw.prepare("UPDATE topics SET createdAt = ? WHERE topicUrl = ?").run("2026-01-01 00:00:00", "u1");
      raw.prepare("UPDATE topics SET createdAt = ? WHERE topicUrl = ?").run("2026-01-02 00:00:00", "u2");
      raw.close();
      const rows = store.getAll();
      assert.deepEqual(rows.map((r) => r.topicUrl), ["u2", "u1"]);
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("getAll({by: 'aiRating'}) sorts by rating, pushing unrated (null) items last regardless of direction", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-results-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new TopicStore(dbPath);
      store.insert(baseTopic("u1", "A"));
      store.insert(baseTopic("u2", "B"));
      store.insert(baseTopic("u3", "C")); // stays unrated
      store.setRating("u1", 30);
      store.setRating("u2", 90);

      const desc = store.getAll({ by: "aiRating", dir: "desc" });
      assert.deepEqual(desc.map((r) => r.topicUrl), ["u2", "u1", "u3"]);

      const asc = store.getAll({ by: "aiRating", dir: "asc" });
      assert.deepEqual(asc.map((r) => r.topicUrl), ["u1", "u2", "u3"]);
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("search()/getByForum()/searchByForum() honor the same sort option", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-results-store-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new TopicStore(dbPath);
      store.insert({ ...baseTopic("u1", "Alpha"), sourceForum: "forumA" });
      store.insert({ ...baseTopic("u2", "Alpha 2"), sourceForum: "forumA" });
      store.setRating("u1", 10);
      store.setRating("u2", 80);

      assert.deepEqual(
        store.search("Alpha", { by: "aiRating", dir: "desc" }).map((r) => r.topicUrl),
        ["u2", "u1"],
      );
      assert.deepEqual(
        store.getByForum("forumA", { by: "aiRating", dir: "desc" }).map((r) => r.topicUrl),
        ["u2", "u1"],
      );
      assert.deepEqual(
        store.searchByForum("Alpha", "forumA", { by: "aiRating", dir: "desc" }).map((r) => r.topicUrl),
        ["u2", "u1"],
      );
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
