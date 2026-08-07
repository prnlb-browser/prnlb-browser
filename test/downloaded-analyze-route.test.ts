import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleDownloadedRoutes } from "../src/downloaded/routes.js";
import { DownloadedStore } from "../src/downloaded/store.js";
import { getDefaultConfig } from "../src/config/store.js";

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

describe("POST /api/downloaded/item/analyze", () => {
  it("400s when id is missing", async () => {
    const app = { getDownloadedStore: () => ({}) as DownloadedStore, loadConfig: () => getDefaultConfig() };
    const { ctx, captured } = makeCtx("POST", "/api/downloaded/item/analyze", {}, app);
    await handleDownloadedRoutes(ctx as never);
    assert.equal(captured.status, 400);
    assert.match(captured.body ?? "", /id is required/);
  });

  it("400s when AI rating is not enabled", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-downloaded-analyze-route-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new DownloadedStore(dbPath);
      const config = getDefaultConfig();
      config.ai.enabled = false;
      const app = { getDownloadedStore: () => store, loadConfig: () => config };
      const { ctx, captured } = makeCtx("POST", "/api/downloaded/item/analyze", { id: 1 }, app);
      await handleDownloadedRoutes(ctx as never);
      assert.equal(captured.status, 400);
      assert.match(captured.body ?? "", /not enabled/);
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("404s when the item doesn't exist", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-downloaded-analyze-route-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new DownloadedStore(dbPath);
      const config = getDefaultConfig();
      config.ai.enabled = true;
      const app = { getDownloadedStore: () => store, loadConfig: () => config };
      const { ctx, captured } = makeCtx("POST", "/api/downloaded/item/analyze", { id: 999 }, app);
      await handleDownloadedRoutes(ctx as never);
      assert.equal(captured.status, 404);
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("400s when the item has no matched topicUrl", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-downloaded-analyze-route-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new DownloadedStore(dbPath);
      store.insert({
        fileName: "video.mp4",
        filePath: "/tmp/video.mp4",
        title: null,
        topicUrl: null,
        postImage: null,
        cachedImage: null,
        starring: null,
        productionDate: null,
        duration: null,
        size: null,
        tags: [],
      });
      const item = store.getAll()[0];
      const config = getDefaultConfig();
      config.ai.enabled = true;
      const app = { getDownloadedStore: () => store, loadConfig: () => config };
      const { ctx, captured } = makeCtx("POST", "/api/downloaded/item/analyze", { id: item.id }, app);
      await handleDownloadedRoutes(ctx as never);
      assert.equal(captured.status, 400);
      assert.match(captured.body ?? "", /topic URL/);
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
