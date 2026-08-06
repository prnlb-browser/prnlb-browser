import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleConfigRoutes } from "../src/config/routes.js";
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

describe("POST /api/config/ai/suggest-rules", () => {
  it("400s when AI rating is not enabled", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-suggest-rules-route-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const downloadedStore = new DownloadedStore(dbPath);
      const config = getDefaultConfig();
      config.ai.enabled = false;
      const app = { getDownloadedStore: () => downloadedStore, loadConfig: () => config };
      const { ctx, captured } = makeCtx("POST", "/api/config/ai/suggest-rules", { count: 1, ruleCount: 5 }, app);
      await handleConfigRoutes(ctx as never);
      assert.equal(captured.status, 400);
      assert.match(captured.body ?? "", /not enabled/);
      downloadedStore.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("400s when there are no downloaded items with a matched topic URL", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-suggest-rules-route-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const downloadedStore = new DownloadedStore(dbPath);
      downloadedStore.insert({
        fileName: "a.mp4",
        filePath: "/videos/a.mp4",
        title: null,
        topicUrl: null,
        postImage: null,
        cachedImage: null,
        starring: null,
        productionDate: null,
        duration: null,
        size: null,
      });
      const config = getDefaultConfig();
      config.ai.enabled = true;
      const app = { getDownloadedStore: () => downloadedStore, loadConfig: () => config };
      const { ctx, captured } = makeCtx("POST", "/api/config/ai/suggest-rules", { count: 1, ruleCount: 5 }, app);
      await handleConfigRoutes(ctx as never);
      assert.equal(captured.status, 400);
      assert.match(captured.body ?? "", /No downloaded items/);
      downloadedStore.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
