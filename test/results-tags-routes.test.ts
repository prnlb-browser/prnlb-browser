import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleResultsRoutes } from "../src/results/routes.js";
import { TopicStore } from "../src/results/store.js";
import { DownloadedStore } from "../src/downloaded/store.js";

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

let store: TopicStore;
let dir: string;
let dbPath: string;

describe("results tag routes", () => {
  it("filters by tags, preserves colors, and exposes all known tags", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-results-tag-route-"));
    dbPath = path.join(dir, "data.db");
    store = new TopicStore(dbPath);
    const app = { getTopicStore: () => store, loadConfig: () => ({}) };

    store.insert({
      topicUrl: "u1", title: "A", postImage: null, starring: null, productionDate: null,
      duration: null, size: null, torrentUrl: null, sourceForum: null, hidden: 0,
      tags: [{ name: "favorite", color: "#22c55e" }],
    });
    store.insert({
      topicUrl: "u2", title: "B", postImage: null, starring: null, productionDate: null,
      duration: null, size: null, torrentUrl: null, sourceForum: null, hidden: 0,
      // Strings without colors should be accepted too — backward compat.
      tags: ["favorite", { name: "4k", color: "#3b82f6" }],
    });
    store.insert({
      topicUrl: "u3", title: "C", postImage: null, starring: null, productionDate: null,
      duration: null, size: null, torrentUrl: null, sourceForum: null, hidden: 0,
      tags: [],
    });

    // GET /api/results — tags field present on every row, with colors.
    {
      const { ctx, captured } = makeCtx("GET", "/api/results", undefined, app);
      const handled = await handleResultsRoutes(ctx);
      assert.equal(handled, true);
      assert.equal(captured.status, 200);
      const body = JSON.parse(captured.body!);
      const byUrl = Object.fromEntries(body.map((r: { topicUrl: string; tags: unknown[] }) => [r.topicUrl, r.tags]));
      assert.deepEqual(byUrl["u1"], [{ name: "favorite", color: "#22c55e" }]);
      assert.deepEqual(byUrl["u2"], [
        { name: "favorite", color: null },
        { name: "4k", color: "#3b82f6" },
      ]);
      assert.deepEqual(byUrl["u3"], []);
    }

    // GET /api/results?tags=favorite — only items containing the tag.
    {
      const { ctx, captured } = makeCtx("GET", "/api/results?tags=favorite", undefined, app);
      const handled = await handleResultsRoutes(ctx);
      assert.equal(handled, true);
      const body = JSON.parse(captured.body!);
      assert.deepEqual(body.map((b: { topicUrl: string }) => b.topicUrl).sort(), ["u1", "u2"]);
    }

    // GET /api/results?tags=favorite,4k — both required.
    {
      const { ctx, captured } = makeCtx("GET", "/api/results?tags=favorite,4k", undefined, app);
      const handled = await handleResultsRoutes(ctx);
      assert.equal(handled, true);
      const body = JSON.parse(captured.body!);
      assert.deepEqual(body.map((b: { topicUrl: string }) => b.topicUrl), ["u2"]);
    }

    // GET /api/results/tags — union of every item's tags, deduped, with colors.
    {
      const { ctx, captured } = makeCtx("GET", "/api/results/tags", undefined, app);
      const handled = await handleResultsRoutes(ctx);
      assert.equal(handled, true);
      const body = JSON.parse(captured.body!);
      assert.deepEqual(body.tags, [
        { name: "4k", color: "#3b82f6" },
        { name: "favorite", color: "#22c55e" },
      ]);
    }

    // PATCH /api/results/tags — update a topic's tags with colors.
    {
      const { ctx, captured } = makeCtx("PATCH", "/api/results/tags", {
        topicUrl: "u3",
        tags: [{ name: "queue", color: null }],
      }, app);
      const handled = await handleResultsRoutes(ctx);
      assert.equal(handled, true);
      const body = JSON.parse(captured.body!);
      assert.deepEqual(body.tags, [{ name: "queue", color: null }]);
    }

    // PATCH on a non-existent topicUrl returns 404.
    {
      const { ctx, captured } = makeCtx("PATCH", "/api/results/tags", { topicUrl: "nope", tags: ["x"] }, app);
      await handleResultsRoutes(ctx);
      assert.equal(captured.status, 404);
    }

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("merges known tags from both the topics and downloaded stores", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-results-tag-merge-"));
    dbPath = path.join(dir, "data.db");
    store = new TopicStore(dbPath);
    const downloadedStore = new DownloadedStore(dbPath);

    store.insert({
      topicUrl: "u1", title: "A", postImage: null, starring: null, productionDate: null,
      duration: null, size: null, torrentUrl: null, sourceForum: null, hidden: 0,
      tags: [{ name: "favorite", color: "#22c55e" }],
    });
    downloadedStore.insert({
      fileName: "a.mp4", filePath: "/tmp/a.mp4", title: null, topicUrl: null, postImage: null,
      cachedImage: null, starring: null, productionDate: null, duration: null, size: null,
      tags: [{ name: "watched", color: "#3b82f6" }],
    });

    const app = {
      getTopicStore: () => store,
      getDownloadedStore: () => downloadedStore,
      loadConfig: () => ({}),
    };

    const { ctx, captured } = makeCtx("GET", "/api/results/tags", undefined, app);
    await handleResultsRoutes(ctx);
    const body = JSON.parse(captured.body!);
    // Both the Results tab's own tag ("favorite") and the Downloaded tab's
    // tag ("watched") show up — the two tabs share one tag vocabulary.
    assert.deepEqual(body.tags, [
      { name: "favorite", color: "#22c55e" },
      { name: "watched", color: "#3b82f6" },
    ]);

    store.close();
    downloadedStore.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
