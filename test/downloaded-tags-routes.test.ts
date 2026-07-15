import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleDownloadedRoutes } from "../src/downloaded/routes.js";
import { DownloadedStore } from "../src/downloaded/store.js";

function makeCtx(method: string, urlStr: string, body?: unknown) {
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
  const app = {
    getDownloadedStore: () => store,
    loadConfig: () => ({ downloadedFolder: "", dbPath }),
    saveConfig: () => {},
  };
  const ctx = { req, res, url: new URL("http://x" + urlStr), method, app };
  return { ctx, captured };
}

let store: DownloadedStore;
let dir: string;
let dbPath: string;

describe("downloaded tag routes", () => {
  it("filters by tags, preserves colors, and exposes all known tags", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-tag-route-"));
    dbPath = path.join(dir, "data.db");
    store = new DownloadedStore(dbPath);

    store.insert({
      fileName: "a.mp4", filePath: "/tmp/a.mp4",
      title: "A", topicUrl: null, postImage: null, cachedImage: null,
      starring: null, productionDate: null, duration: null, size: null,
      tags: [{ name: "favorite", color: "#22c55e" }],
    });
    store.insert({
      fileName: "b.mp4", filePath: "/tmp/b.mp4",
      title: "B", topicUrl: null, postImage: null, cachedImage: null,
      starring: null, productionDate: null, duration: null, size: null,
      // Strings without colors should be accepted too — backward compat.
      tags: ["favorite", { name: "4k", color: "#3b82f6" }],
    });
    store.insert({
      fileName: "c.mp4", filePath: "/tmp/c.mp4",
      title: "C", topicUrl: null, postImage: null, cachedImage: null,
      starring: null, productionDate: null, duration: null, size: null,
      tags: [],
    });

    // GET /api/downloaded — tags field present on every row, with colors.
    {
      const { ctx, captured } = makeCtx("GET", "/api/downloaded");
      const handled = await handleDownloadedRoutes(ctx);
      assert.equal(handled, true);
      assert.equal(captured.status, 200);
      const body = JSON.parse(captured.body!);
      assert.equal(body.length, 3);
      // Sort by id so the test doesn't depend on createdAt ordering.
      const byFile = Object.fromEntries(
        body
          .slice()
          .sort((a: { id: number }, b: { id: number }) => a.id - b.id)
          .map((r: { fileName: string; tags: unknown[] }) => [r.fileName, r.tags]),
      );
      assert.deepEqual(byFile["a.mp4"], [{ name: "favorite", color: "#22c55e" }]);
      assert.deepEqual(byFile["b.mp4"], [
        { name: "favorite", color: null },
        { name: "4k", color: "#3b82f6" },
      ]);
      assert.deepEqual(byFile["c.mp4"], []);
    }

    // GET /api/downloaded?tags=favorite — only items containing the tag.
    {
      const { ctx, captured } = makeCtx("GET", "/api/downloaded?tags=favorite");
      const handled = await handleDownloadedRoutes(ctx);
      assert.equal(handled, true);
      const body = JSON.parse(captured.body!);
      assert.deepEqual(body.map((b: { fileName: string }) => b.fileName).sort(), ["a.mp4", "b.mp4"]);
    }

    // GET /api/downloaded?tags=favorite,4k — both required.
    {
      const { ctx, captured } = makeCtx("GET", "/api/downloaded?tags=favorite,4k");
      const handled = await handleDownloadedRoutes(ctx);
      assert.equal(handled, true);
      const body = JSON.parse(captured.body!);
      assert.deepEqual(body.map((b: { fileName: string }) => b.fileName), ["b.mp4"]);
    }

    // GET /api/downloaded/tags — union of every item's tags, deduped, with colors.
    {
      const { ctx, captured } = makeCtx("GET", "/api/downloaded/tags");
      const handled = await handleDownloadedRoutes(ctx);
      assert.equal(handled, true);
      const body = JSON.parse(captured.body!);
      assert.deepEqual(body.tags, [
        { name: "4k", color: "#3b82f6" },
        { name: "favorite", color: "#22c55e" },
      ]);
    }

    // PATCH /api/downloaded/tags — update an item's tags with colors.
    {
      const id = store.getAll()[0]!.id;
      const { ctx, captured } = makeCtx("PATCH", "/api/downloaded/tags", {
        id,
        tags: [{ name: "favorite", color: "#22c55e" }, { name: "queue", color: null }],
      });
      const handled = await handleDownloadedRoutes(ctx);
      assert.equal(handled, true);
      const body = JSON.parse(captured.body!);
      assert.deepEqual(body.tags, [
        { name: "favorite", color: "#22c55e" },
        { name: "queue", color: null },
      ]);
    }

    // GET /api/downloaded/tags — includes the newly added "queue" tag.
    {
      const { ctx, captured } = makeCtx("GET", "/api/downloaded/tags");
      await handleDownloadedRoutes(ctx);
      const body = JSON.parse(captured.body!);
      assert.deepEqual(body.tags, [
        { name: "4k", color: "#3b82f6" },
        { name: "favorite", color: "#22c55e" },
        { name: "queue", color: null },
      ]);
    }

    // PATCH on a non-existent id returns 404.
    {
      const { ctx, captured } = makeCtx("PATCH", "/api/downloaded/tags", { id: 999999, tags: ["x"] });
      await handleDownloadedRoutes(ctx);
      assert.equal(captured.status, 404);
    }

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});