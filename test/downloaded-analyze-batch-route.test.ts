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

describe("POST /api/downloaded/analyze-batch", () => {
  it("400s when AI rating is not enabled", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-downloaded-analyze-batch-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new DownloadedStore(dbPath);
      const config = getDefaultConfig();
      config.ai.enabled = false;
      const app = { getDownloadedStore: () => store, loadConfig: () => config };
      const { ctx, captured } = makeCtx("POST", "/api/downloaded/analyze-batch", { ids: [1] }, app);
      await handleDownloadedRoutes(ctx as never);
      assert.equal(captured.status, 400);
      assert.match(captured.body ?? "", /not enabled/);
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("400s when ids is missing or empty", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-downloaded-analyze-batch-"));
    const dbPath = path.join(dir, "data.db");
    try {
      const store = new DownloadedStore(dbPath);
      const config = getDefaultConfig();
      config.ai.enabled = true;
      const app = { getDownloadedStore: () => store, loadConfig: () => config };

      const { ctx: ctx1, captured: c1 } = makeCtx("POST", "/api/downloaded/analyze-batch", { ids: [] }, app);
      await handleDownloadedRoutes(ctx1 as never);
      assert.equal(c1.status, 400);

      const { ctx: ctx2, captured: c2 } = makeCtx("POST", "/api/downloaded/analyze-batch", {}, app);
      await handleDownloadedRoutes(ctx2 as never);
      assert.equal(c2.status, 400);
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
