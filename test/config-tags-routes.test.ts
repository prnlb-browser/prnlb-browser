import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleConfigRoutes } from "../src/config/routes.js";
import { TopicStore } from "../src/results/store.js";
import { DownloadedStore } from "../src/downloaded/store.js";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-config-tags-"));
  const dbPath = path.join(dir, "data.db");
  const topics = new TopicStore(dbPath);
  const downloaded = new DownloadedStore(dbPath);
  topics.insert({
    topicUrl: "hidden", title: "Hidden topic", postImage: null, starring: null,
    productionDate: null, duration: null, size: null, torrentUrl: null,
    sourceForum: null, hidden: 1, comments: "Keep this", aiRating: 75,
    tags: [{ name: "Favorite", color: "#22c55e" }, { name: "Other", color: "blue" }],
  });
  topics.insert({
    topicUrl: "visible", title: "Visible topic", postImage: null, starring: null,
    productionDate: null, duration: null, size: null, torrentUrl: null,
    sourceForum: null, hidden: 0, tags: [{ name: "FAVORITE", color: null }],
  });
  downloaded.insert({
    fileName: "video.mp4", filePath: path.join(dir, "video.mp4"), title: "Video",
    topicUrl: null, postImage: null, cachedImage: null, starring: null,
    productionDate: null, duration: null, size: null, comments: "Downloaded notes",
    tags: [{ name: "favorite", color: "red" }, { name: "Downloaded only", color: null }],
  });
  const app = { getTopicStore: () => topics, getDownloadedStore: () => downloaded };
  return {
    dbPath, topics, downloaded,
    async request(method: string, body?: unknown, rawBody?: string) {
      const data = rawBody ?? (body === undefined ? "" : JSON.stringify(body));
      const req = {
        on(event: string, cb: (chunk?: Buffer) => void) {
          if (event === "data" && data) cb(Buffer.from(data));
          if (event === "end") cb();
        },
      };
      let status = 0;
      let response = "";
      const res = {
        writeHead(value: number) { status = value; },
        end(value: string) { response = value; },
      };
      const handled = await handleConfigRoutes({
        req, res, url: new URL("http://localhost/api/config/tags"), method, app,
      } as never);
      assert.equal(handled, true);
      return { status, body: JSON.parse(response) };
    },
    close() {
      topics.close();
      downloaded.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("Config tag management", () => {
  it("lists the shared vocabulary and renames/recolors all uses including hidden topics", async () => {
    const f = fixture();
    try {
      const list = await f.request("GET");
      assert.equal(list.status, 200);
      assert.deepEqual(list.body.tags.map((tag: { name: string }) => tag.name.toLowerCase()),
        ["downloaded only", "favorite", "other"]);

      const result = await f.request("PATCH", { name: " favorite ", newName: " Rewatch ", color: "#6366f1" });
      assert.equal(result.status, 200);
      assert.equal(result.body.updatedResults, 2);
      assert.equal(result.body.updatedDownloaded, 1);
      assert.deepEqual(f.topics.getByUrl("hidden")?.tags, [
        { name: "Rewatch", color: "#6366f1" }, { name: "Other", color: "blue" },
      ]);
      assert.deepEqual(f.topics.getByUrl("visible")?.tags, [{ name: "Rewatch", color: "#6366f1" }]);
      assert.deepEqual(f.downloaded.getById(1)?.tags, [
        { name: "Rewatch", color: "#6366f1" }, { name: "Downloaded only", color: null },
      ]);
      assert.equal(f.topics.getByUrl("hidden")?.hidden, 1);
      assert.equal(f.topics.getByUrl("hidden")?.comments, "Keep this");
      assert.equal(f.topics.getByUrl("hidden")?.aiRating, 75);
      assert.equal(f.downloaded.getById(1)?.comments, "Downloaded notes");

      const reopenedTopics = new TopicStore(f.dbPath);
      const reopenedDownloaded = new DownloadedStore(f.dbPath);
      try {
        assert.deepEqual(reopenedTopics.getByUrl("visible")?.tags, [{ name: "Rewatch", color: "#6366f1" }]);
        assert.equal(reopenedDownloaded.getById(1)?.tags?.[0]?.name, "Rewatch");
      } finally {
        reopenedTopics.close();
        reopenedDownloaded.close();
      }
    } finally { f.close(); }
  });

  it("supports color-only changes, clearing color, and casing-only renames", async () => {
    const f = fixture();
    try {
      assert.equal((await f.request("PATCH", { name: "favorite", color: "#abcdef" })).status, 200);
      for (const item of [...f.topics.getAll(), ...f.downloaded.getAll()]) {
        assert.deepEqual(item.tags?.[0], { name: "favorite", color: "#abcdef" });
      }
      assert.equal((await f.request("PATCH", { name: "FAVORITE", newName: "FAVORITE", color: null })).status, 200);
      assert.deepEqual(f.topics.getByUrl("visible")?.tags, [{ name: "FAVORITE", color: null }]);
      assert.deepEqual(f.downloaded.getById(1)?.tags?.[0], { name: "FAVORITE", color: null });
      assert.equal((await f.request("PATCH", { name: "favorite", newName: "Watch again" })).status, 200);
      assert.deepEqual(f.topics.getByUrl("visible")?.tags, [{ name: "Watch again", color: null }]);
    } finally { f.close(); }
  });

  it("removes the tag everywhere without deleting items or other tags", async () => {
    const f = fixture();
    try {
      const result = await f.request("DELETE", { name: "FAVORITE" });
      assert.equal(result.status, 200);
      assert.equal(result.body.updatedResults, 2);
      assert.equal(result.body.updatedDownloaded, 1);
      assert.deepEqual(f.topics.getByUrl("visible")?.tags, []);
      assert.deepEqual(f.topics.getByUrl("hidden")?.tags, [{ name: "Other", color: "blue" }]);
      assert.deepEqual(f.downloaded.getById(1)?.tags, [{ name: "Downloaded only", color: null }]);
      assert.equal(f.topics.count(), 2);
      assert.equal(f.downloaded.getAll().length, 1);
      assert.ok(!result.body.tags.some((tag: { name: string }) => tag.name.toLowerCase() === "favorite"));
    } finally { f.close(); }
  });

  it("rejects duplicate names, invalid inputs, and missing tags without changing items", async () => {
    const f = fixture();
    try {
      const beforeTopics = f.topics.getAll();
      const beforeDownloaded = f.downloaded.getAll();
      for (const newName of ["other", " DOWNLOADED ONLY "]) {
        assert.equal((await f.request("PATCH", { name: "favorite", newName })).status, 409);
      }
      for (const body of [null, {}, { name: 123 }, { name: " " },
        { name: "favorite", newName: " " }, { name: "favorite", newName: 123 },
        { name: "favorite", color: 123 }, { name: "favorite", color: "invalid-color" }]) {
        assert.equal((await f.request("PATCH", body)).status, 400);
      }
      assert.equal((await f.request("PATCH", undefined, "{invalid")).status, 400);
      assert.equal((await f.request("PATCH", { name: "missing", newName: "new" })).status, 404);
      assert.equal((await f.request("DELETE", { name: "missing" })).status, 404);
      assert.equal((await f.request("DELETE", {})).status, 400);
      assert.deepEqual(f.topics.getAll(), beforeTopics);
      assert.deepEqual(f.downloaded.getAll(), beforeDownloaded);
    } finally { f.close(); }
  });
});
