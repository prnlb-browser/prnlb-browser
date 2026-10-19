import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DownloadedSharing, parseByteRange } from "../src/downloaded/lan-server.js";
import type { AppContext } from "../src/core/server/context.js";

test("byte ranges handle seeking, suffixes, bounds, and invalid ranges", () => {
  assert.deepEqual(parseByteRange("bytes=2-4", 10), { start: 2, end: 4 });
  assert.deepEqual(parseByteRange("bytes=2-", 10), { start: 2, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange("bytes=0-100", 10), { start: 0, end: 9 });
  for (const value of ["bytes=10-", "bytes=4-2", "bytes=-0", "bytes=0-1,3-4", "bytes=-", "bytes=99999999999999999999-"]) assert.equal(parseByteRange(value, 10), null);
  assert.equal(parseByteRange("bytes=0-", 0), null);
});

async function unusedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}

test("LAN library authenticates, isolates desktop APIs, streams known files, and stops", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-sharing-"));
  fs.writeFileSync(path.join(root, "movie.mp4"), "0123456789");
  fs.mkdirSync(path.join(root, ".images"));
  fs.writeFileSync(path.join(root, ".images", "cover.jpg"), "cover");
  fs.writeFileSync(path.join(root, "secret.jpg"), "secret");
  fs.symlinkSync(path.join(root, "secret.jpg"), path.join(root, ".images", "escape.jpg"));
  const item = { id: 1, fileName: "movie.mp4", filePath: path.join(root, "movie.mp4"), title: "Title", cachedImage: "cover.jpg" };
  const app = { staticDir: path.resolve("public"), getDownloadedStore: () => ({ getAll: () => [item], getById: (id: number) => id === 1 ? item : undefined }) } as unknown as AppContext;
  const sharing = new DownloadedSharing(app);
  const port = await unusedPort();
  const key = "x";
  const origin = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Basic ${Buffer.from(`viewer:${key}`).toString("base64")}` };
  try {
    await sharing.configure({ enabled: true, port, username: "viewer", accessKey: key });
    assert.equal(sharing.status().running, true);
    assert.equal((await fetch(origin + "/library")).status, 401);
    assert.equal((await fetch(origin + "/", { headers })).status, 200);
    const listing = await (await fetch(origin + "/library", { headers })).json();
    assert.equal(listing[0].title, "Title");
    assert.equal(listing[0].filePath, undefined);
    for (const endpoint of ["/api/config", "/mcp", "/api/downloaded", "/items/2/file", "/items/1/../../secret.jpg"]) assert.equal((await fetch(origin + endpoint, { headers })).status, 404);
    assert.equal((await fetch(origin + "/items/1/file", { method: "DELETE", headers })).status, 405);
    const partial = await fetch(origin + "/items/1/file", { headers: { ...headers, Range: "bytes=2-4" } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), "bytes 2-4/10");
    assert.equal(await partial.text(), "234");
    const head = await fetch(origin + "/items/1/file", { method: "HEAD", headers });
    assert.equal(head.headers.get("content-length"), "10");
    assert.equal(await head.text(), "");
    assert.equal((await fetch(origin + "/items/1/file", { headers: { ...headers, Range: "bytes=50-" } })).status, 416);
    const download = await fetch(origin + "/items/1/file?download", { headers });
    assert.match(download.headers.get("content-disposition")!, /attachment/);
    assert.equal(await download.text(), "0123456789");
    assert.equal(await (await fetch(origin + "/items/1/image", { headers })).text(), "cover");
    item.cachedImage = "escape.jpg";
    assert.equal((await fetch(origin + "/items/1/image", { headers })).status, 404);
    await sharing.configure({ enabled: true, port, username: "another-viewer", accessKey: "p" });
    assert.equal((await fetch(origin + "/library", { headers })).status, 401);
    await sharing.configure({ enabled: false, port });
    assert.equal(sharing.status().running, false);
    assert.deepEqual(sharing.status().urls, []);
  } finally { sharing.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
