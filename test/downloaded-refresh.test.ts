import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startServer } from "../src/core/server/index.js";

// Exercise the same incremental endpoint as the Downloaded Refresh button.
test("Refresh removes missing files even after the selected folder is deleted", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-refresh-"));
  const folder = path.join(root, "videos");
  fs.mkdirSync(folder);
  const missing = path.join(folder, "gone.mp4");
  const remaining = path.join(root, "keep.mp4");
  fs.writeFileSync(missing, "gone");
  fs.writeFileSync(remaining, "keep");
  const info = await startServer({ userDataDir: root, port: 0 });
  const store = info.app.getDownloadedStore();
  const origin = `http://127.0.0.1:${info.port}`;
  const insert = (filePath: string) => store.insert({ fileName: path.basename(filePath), filePath,
    title: "Keep metadata", topicUrl: "topic", postImage: null, cachedImage: null, starring: null,
    productionDate: null, duration: null, size: null, tags: [{ name: "Favorite", color: null }] });
  const scan = (mode = "scan-incremental", folderPath = folder) => fetch(`${origin}/api/downloaded/${mode}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderPath }),
  });
  try {
    insert(missing);
    insert(remaining);
    fs.rmSync(folder, { recursive: true });
    // Full scans still reject missing folders and leave saved data untouched.
    assert.equal((await scan("scan-folder")).status, 400);
    assert.equal(store.getAll().length, 2);
    assert.equal((await scan("scan-incremental", "relative/path")).status, 400);
    assert.equal(store.getAll().length, 2);
    const response = await scan();
    assert.equal(response.status, 200);
    const events = (await response.text()).split("\n").filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    const done = events.find((event) => event.phase === "done");
    assert.ok(done);
    assert.equal(done.items.length, 1);
    assert.equal(done.items[0].filePath, remaining);
    assert.deepEqual(store.getAll().map((item) => item.filePath), [remaining]);
    assert.equal(store.getAll()[0]!.title, "Keep metadata");
    assert.equal(store.getAll()[0]!.tags![0]!.name, "Favorite");
    assert.equal(fs.existsSync(folder), false);

    // The same cleanup works for individual files in an existing folder.
    fs.mkdirSync(folder);
    insert(missing);
    const refresh = await scan();
    assert.equal(refresh.status, 200);
    await refresh.text();
    assert.deepEqual(store.getAll().map((item) => item.filePath), [remaining]);
  } finally {
    await info.app.mcp.close();
    info.server.closeAllConnections();
    await new Promise<void>((resolve) => info.server.close(() => resolve()));
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
