import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DownloadedStore } from "../src/downloaded/store.js";
import { handleDownloadedRoutes } from "../src/downloaded/routes.js";
import { getDefaultConfig } from "../src/config/store.js";

function baseItem(overrides: Partial<Parameters<DownloadedStore["insert"]>[0]> = {}) {
  return {
    fileName: "movie.mp4",
    filePath: `/tmp/${Math.random()}.mp4`,
    title: "Some movie",
    topicUrl: "https://example.com/t=1",
    postImage: null,
    cachedImage: null,
    starring: null,
    productionDate: null,
    duration: null,
    size: null,
    ...overrides,
  };
}

describe("DownloadedStore aiRating", () => {
  it("defaults to null and can be set/read via setAiRating", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-downloaded-airating-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new DownloadedStore(dbPath);
      store.insert(baseItem());
      const item = store.getAll()[0]!;
      assert.equal(item.aiRating, null);

      assert.equal(store.setAiRating(item.id, 63), true);
      assert.equal(store.getById(item.id)!.aiRating, 63);

      store.setAiRating(item.id, null);
      assert.equal(store.getById(item.id)!.aiRating, null);

      assert.equal(store.setAiRating(999999, 10), false);
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("migrates an older downloaded table (no aiRating column) without losing rows", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-downloaded-airating-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const Database = require("better-sqlite3");
      const db = new Database(dbPath);
      db.exec(
        "CREATE TABLE downloaded (id INTEGER PRIMARY KEY AUTOINCREMENT, fileName TEXT NOT NULL, filePath TEXT NOT NULL UNIQUE, title TEXT, topicUrl TEXT, postImage TEXT, cachedImage TEXT, starring TEXT, productionDate TEXT, duration TEXT, size TEXT, tags TEXT NOT NULL DEFAULT '[]', createdAt TEXT NOT NULL DEFAULT (datetime('now')))",
      );
      db.prepare("INSERT INTO downloaded (fileName, filePath) VALUES (?, ?)").run("legacy.mp4", "/tmp/legacy.mp4");
      db.close();

      const store = new DownloadedStore(dbPath);
      const rows = store.getAll();
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.aiRating, null);
      assert.equal(store.setAiRating(rows[0]!.id, 50), true);
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

function makeCtx(method: string, urlStr: string, body: unknown, app: unknown) {
  const data = body !== undefined ? JSON.stringify(body) : "";
  const req = {
    on(ev: string, cb: (chunk?: Buffer) => void) {
      if (ev === "data" && data) cb(Buffer.from(data));
      if (ev === "end") cb();
    },
    headers: {},
  };
  let captured: { status?: number; headers?: Record<string, string>; body?: string } = {};
  const res = {
    writeHead(s: number, h: Record<string, string>) {
      captured.status = s;
      captured.headers = h;
    },
    end(d?: string) {
      captured.body = d;
    },
    flushHeaders() {},
    write() {},
  };
  const ctx = { req, res, url: new URL("http://x" + urlStr), method, app };
  return { ctx, captured };
}

describe("GET /api/downloaded?sortBy=aiRating", () => {
  it("sorts by aiRating, pushing unrated (null) items last regardless of direction", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-downloaded-airating-route-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new DownloadedStore(dbPath);
      store.insert(baseItem({ fileName: "a.mp4", filePath: "/tmp/a.mp4" }));
      store.insert(baseItem({ fileName: "b.mp4", filePath: "/tmp/b.mp4" }));
      store.insert(baseItem({ fileName: "c.mp4", filePath: "/tmp/c.mp4" }));
      const items = store.getAll();
      const a = items.find((i) => i.fileName === "a.mp4")!;
      const b = items.find((i) => i.fileName === "b.mp4")!;
      // c.mp4 stays unrated (null)
      store.setAiRating(a.id, 30);
      store.setAiRating(b.id, 90);

      const app = { getDownloadedStore: () => store, loadConfig: () => getDefaultConfig() };
      const { ctx, captured } = makeCtx("GET", "/api/downloaded?sortBy=aiRating&sortDir=desc", undefined, app);
      await handleDownloadedRoutes(ctx as never);
      const body = JSON.parse(captured.body ?? "[]") as { fileName: string }[];
      assert.deepEqual(
        body.map((i) => i.fileName),
        ["b.mp4", "a.mp4", "c.mp4"],
      );
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
