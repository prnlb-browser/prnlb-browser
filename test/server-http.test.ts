import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { serveStatic } from "../src/core/server/http.js";

function request(server: http.Server, requestPath: string): Promise<{ status: number; body: string }> {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: address.port, path: requestPath }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8") }));
    }).on("error", reject);
  });
}

describe("serveStatic", () => {
  it("serves files under the static root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-static-"));
    fs.writeFileSync(path.join(root, "index.html"), "hello");
    const server = http.createServer((_req, response) => {
      if (!serveStatic(response, root, "/")) response.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      assert.deepEqual(await request(server, "/"), { status: 200, body: "hello" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects traversal outside the static root", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-static-"));
    const root = path.join(parent, "public");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(parent, "secret.txt"), "secret");
    const server = http.createServer((_req, response) => {
      const served = serveStatic(response, root, "/../secret.txt");
      response.statusCode = served ? 200 : 404;
      if (!served) response.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      assert.deepEqual(await request(server, "/../secret.txt"), { status: 404, body: "missing" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});
