import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleActressRoutes } from "../src/actresses/routes.js";
import { ActressStore } from "../src/actresses/store.js";

function makeCtx(method: string, urlStr: string, body?: unknown) {
  const data = body !== undefined ? JSON.stringify(body) : "";
  const req = {
    on(ev: string, cb: (chunk?: Buffer) => void) {
      if (ev === "data" && data) cb(Buffer.from(data));
      if (ev === "end") cb();
    },
    headers: {},
  };
  const captured: { status?: number; headers?: Record<string, string>; body?: string | Buffer } = {};
  const res = {
    writeHead(s: number, h: Record<string, string>) {
      captured.status = s;
      captured.headers = h;
    },
    end(d?: string | Buffer) {
      captured.body = d;
    },
  };
  const app = { getActressStore: () => store, userDataDir };
  const ctx = { req, res, url: new URL("http://x" + urlStr), method, app };
  return { ctx, captured };
}

let store: ActressStore;
let dir: string;
let userDataDir: string;

describe("actress routes", () => {
  it("supports create, list, find-by-alias, patch, and delete without touching other tables", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-actress-route-"));
    userDataDir = dir;
    store = new ActressStore(path.join(dir, "data.db"));

    // POST /api/actresses — create.
    let createdId: number;
    {
      const { ctx, captured } = makeCtx("POST", "/api/actresses", { name: "Jane Doe", otherNames: ["JD", "Janie"] });
      const handled = await handleActressRoutes(ctx as never);
      assert.equal(handled, true);
      assert.equal(captured.status, 201);
      const body = JSON.parse(captured.body as string);
      assert.equal(body.name, "Jane Doe");
      assert.deepEqual(body.otherNames, ["JD", "Janie"]);
      createdId = body.id;
    }

    // POST /api/actresses without a name — 400.
    {
      const { ctx, captured } = makeCtx("POST", "/api/actresses", { name: "  " });
      await handleActressRoutes(ctx as never);
      assert.equal(captured.status, 400);
    }

    // GET /api/actresses — includes the created row.
    {
      const { ctx, captured } = makeCtx("GET", "/api/actresses");
      const handled = await handleActressRoutes(ctx as never);
      assert.equal(handled, true);
      const body = JSON.parse(captured.body as string);
      assert.equal(body.length, 1);
      assert.equal(body[0].name, "Jane Doe");
    }

    // GET /api/actresses/find?name=... — matches an alias case-insensitively.
    {
      const { ctx, captured } = makeCtx("GET", "/api/actresses/find?name=janie");
      const handled = await handleActressRoutes(ctx as never);
      assert.equal(handled, true);
      const body = JSON.parse(captured.body as string);
      assert.ok(body.actress);
      assert.equal(body.actress.name, "Jane Doe");
    }

    // GET /api/actresses/find?name=... — no match returns { actress: null }.
    {
      const { ctx, captured } = makeCtx("GET", "/api/actresses/find?name=nobody");
      await handleActressRoutes(ctx as never);
      const body = JSON.parse(captured.body as string);
      assert.equal(body.actress, null);
    }

    // PATCH /api/actresses/item — update name/otherNames.
    {
      const { ctx, captured } = makeCtx("PATCH", "/api/actresses/item", {
        id: createdId!,
        name: "Jane A. Doe",
        otherNames: ["JD"],
      });
      const handled = await handleActressRoutes(ctx as never);
      assert.equal(handled, true);
      const body = JSON.parse(captured.body as string);
      assert.equal(body.name, "Jane A. Doe");
      assert.deepEqual(body.otherNames, ["JD"]);
    }

    // PATCH on a non-existent id — 404.
    {
      const { ctx, captured } = makeCtx("PATCH", "/api/actresses/item", { id: 999999, name: "x" });
      await handleActressRoutes(ctx as never);
      assert.equal(captured.status, 404);
    }

    // PATCH /api/actresses/item/favorite — toggles isFavorite and returns the new value.
    {
      const { ctx, captured } = makeCtx("PATCH", "/api/actresses/item/favorite", { id: createdId! });
      const handled = await handleActressRoutes(ctx as never);
      assert.equal(handled, true);
      const body = JSON.parse(captured.body as string);
      assert.equal(body.isFavorite, true);
      assert.equal(store.getById(createdId!)!.isFavorite, true);
    }
    {
      const { ctx, captured } = makeCtx("PATCH", "/api/actresses/item/favorite", { id: createdId! });
      await handleActressRoutes(ctx as never);
      const body = JSON.parse(captured.body as string);
      assert.equal(body.isFavorite, false);
    }

    // PATCH .../favorite on a non-existent id — 404.
    {
      const { ctx, captured } = makeCtx("PATCH", "/api/actresses/item/favorite", { id: 999999 });
      await handleActressRoutes(ctx as never);
      assert.equal(captured.status, 404);
    }

    // DELETE /api/actresses/item — removes the row.
    {
      const { ctx, captured } = makeCtx("DELETE", `/api/actresses/item?id=${createdId!}`);
      const handled = await handleActressRoutes(ctx as never);
      assert.equal(handled, true);
      const body = JSON.parse(captured.body as string);
      assert.equal(body.deleted, true);
      assert.equal(store.getById(createdId!), undefined);
    }

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("exposes the boobpedia lookup provider and validates lookup requests", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-actress-lookup-"));
    userDataDir = dir;
    store = new ActressStore(path.join(dir, "data.db"));

    // GET /api/actresses/lookup/providers — lists the registered sources.
    {
      const { ctx, captured } = makeCtx("GET", "/api/actresses/lookup/providers");
      const handled = await handleActressRoutes(ctx as never);
      assert.equal(handled, true);
      const body = JSON.parse(captured.body as string);
      assert.ok(body.some((p: { id: string }) => p.id === "boobpedia"));
    }

    // GET /api/actresses/lookup/search with an unknown provider — 400.
    {
      const { ctx, captured } = makeCtx("GET", "/api/actresses/lookup/search?provider=nope&query=x");
      await handleActressRoutes(ctx as never);
      assert.equal(captured.status, 400);
    }

    // GET /api/actresses/lookup/search with no query — 400.
    {
      const { ctx, captured } = makeCtx("GET", "/api/actresses/lookup/search?provider=boobpedia&query=");
      await handleActressRoutes(ctx as never);
      assert.equal(captured.status, 400);
    }

    // GET /api/actresses/lookup/details with no title — 400.
    {
      const { ctx, captured } = makeCtx("GET", "/api/actresses/lookup/details?provider=boobpedia&title=");
      await handleActressRoutes(ctx as never);
      assert.equal(captured.status, 400);
    }

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
