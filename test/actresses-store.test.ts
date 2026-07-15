import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ActressStore } from "../src/actresses/store.js";

function withStore(fn: (store: ActressStore) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-actress-store-"));
  const dbPath = path.join(dir, "data.db");
  const store = new ActressStore(dbPath);
  try {
    fn(store);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("ActressStore", () => {
  it("inserts an actress with normalized, deduped otherNames", () => {
    withStore((store) => {
      const created = store.insert({
        name: " Alice ",
        otherNames: ["Alicia", " alicia ", "", "Ali", 42 as unknown as string],
      });
      assert.equal(created.name, "Alice");
      assert.deepEqual(created.otherNames, ["Alicia", "Ali"]);
      assert.equal(created.postImage, null);
      assert.equal(created.cachedImage, null);
    });
  });

  it("getAll() returns actresses sorted by name case-insensitively", () => {
    withStore((store) => {
      store.insert({ name: "charlie" });
      store.insert({ name: "Bob" });
      store.insert({ name: "alice" });
      assert.deepEqual(store.getAll().map((a) => a.name), ["alice", "Bob", "charlie"]);
    });
  });

  it("findByName() matches the primary name case-insensitively", () => {
    withStore((store) => {
      store.insert({ name: "Jane Doe" });
      const found = store.findByName("  jane doe ");
      assert.ok(found);
      assert.equal(found!.name, "Jane Doe");
      assert.equal(store.findByName("nobody"), undefined);
    });
  });

  it("findByName() matches any alias", () => {
    withStore((store) => {
      store.insert({ name: "Jane Doe", otherNames: ["JD", "Janie"] });
      const found = store.findByName("janie");
      assert.ok(found);
      assert.equal(found!.name, "Jane Doe");
    });
  });

  it("updateItem() applies a partial set of fields without touching the rest", () => {
    withStore((store) => {
      const created = store.insert({ name: "Alice", otherNames: ["Al"], postImage: "https://x/a.jpg", cachedImage: "a.jpg" });
      store.updateItem(created.id, { name: "Alice Smith" });
      const updated = store.getById(created.id);
      assert.equal(updated!.name, "Alice Smith");
      assert.deepEqual(updated!.otherNames, ["Al"]);
      assert.equal(updated!.cachedImage, "a.jpg");
    });
  });

  it("updateItem() with an empty payload is a no-op", () => {
    withStore((store) => {
      const created = store.insert({ name: "Alice" });
      assert.equal(store.updateItem(created.id, {}), false);
    });
  });

  it("updateItem() can clear the picture fields", () => {
    withStore((store) => {
      const created = store.insert({ name: "Alice", postImage: "https://x/a.jpg", cachedImage: "a.jpg" });
      store.updateItem(created.id, { postImage: null, cachedImage: null });
      const updated = store.getById(created.id);
      assert.equal(updated!.postImage, null);
      assert.equal(updated!.cachedImage, null);
    });
  });

  it("inserts with isFavorite defaulting to false, and updateItem() can set it", () => {
    withStore((store) => {
      const created = store.insert({ name: "Alice" });
      assert.equal(created.isFavorite, false);
      store.updateItem(created.id, { isFavorite: true });
      assert.equal(store.getById(created.id)!.isFavorite, true);
    });
  });

  it("toggleFavorite() flips the flag and returns the new value", () => {
    withStore((store) => {
      const created = store.insert({ name: "Alice" });
      assert.equal(store.toggleFavorite(created.id), true);
      assert.equal(store.getById(created.id)!.isFavorite, true);
      assert.equal(store.toggleFavorite(created.id), false);
      assert.equal(store.getById(created.id)!.isFavorite, false);
      assert.equal(store.toggleFavorite(999999), undefined);
    });
  });

  it("deleteById() removes the row", () => {
    withStore((store) => {
      const created = store.insert({ name: "Alice" });
      assert.equal(store.deleteById(created.id), true);
      assert.equal(store.getById(created.id), undefined);
      assert.equal(store.deleteById(created.id), false);
    });
  });

  it("decodes malformed otherNames JSON safely to an empty array", () => {
    withStore((store) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-actress-raw-"));
      const dbPath = path.join(dir, "data.db");
      try {
        const Database = require("better-sqlite3");
        const db = new Database(dbPath);
        db.exec(
          "CREATE TABLE actresses (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, otherNames TEXT NOT NULL DEFAULT '[]', postImage TEXT, cachedImage TEXT, createdAt TEXT NOT NULL DEFAULT (datetime('now')))",
        );
        db.prepare("INSERT INTO actresses (name, otherNames) VALUES (?, ?)").run("Legacy", "not-json");
        db.close();

        const raw = new ActressStore(dbPath);
        const row = raw.getAll()[0]!;
        assert.deepEqual(row.otherNames, []);
        raw.close();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
