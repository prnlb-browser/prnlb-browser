import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleSearchRoutes } from "../src/search/routes.js";
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

describe("POST /api/search/item/analyze", () => {
  it("400s when topicUrl or title is missing", async () => {
    const app = { loadConfig: () => getDefaultConfig() };

    const { ctx: ctx1, captured: c1 } = makeCtx("POST", "/api/search/item/analyze", { title: "t" }, app);
    await handleSearchRoutes(ctx1 as never);
    assert.equal(c1.status, 400);
    assert.match(c1.body ?? "", /required/);

    const { ctx: ctx2, captured: c2 } = makeCtx("POST", "/api/search/item/analyze", { topicUrl: "u1" }, app);
    await handleSearchRoutes(ctx2 as never);
    assert.equal(c2.status, 400);
    assert.match(c2.body ?? "", /required/);
  });

  it("400s when AI rating is not enabled", async () => {
    const config = getDefaultConfig();
    config.ai.enabled = false;
    const app = { loadConfig: () => config };
    const { ctx, captured } = makeCtx("POST", "/api/search/item/analyze", { topicUrl: "u1", title: "t" }, app);
    await handleSearchRoutes(ctx as never);
    assert.equal(captured.status, 400);
    assert.match(captured.body ?? "", /not enabled/);
  });
});
