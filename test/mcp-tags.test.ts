import { describe, it, type TestContext } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startServer, type ServerInfo } from "../src/core/server/index.js";
import type { Tag } from "../src/core/tags.js";
import type { TagManagementResult } from "../src/core/tag-management.js";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

function toolText(result: ToolResult): string {
  assert.ok(Array.isArray(result.content));
  const block = result.content[0];
  assert.equal(block?.type, "text");
  assert.equal(typeof block.text, "string");
  return block.text as string;
}

function payload<T>(result: ToolResult): T {
  assert.notEqual(result.isError, true, toolText(result));
  return JSON.parse(toolText(result)) as T;
}

async function fixture(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-mcp-tags-"));
  const client = new Client({ name: "tag-management-test", version: "1.0.0" });
  let info: ServerInfo | undefined;
  let transport: StreamableHTTPClientTransport | undefined;
  t.after(async () => {
    try {
      if (transport?.sessionId) await transport.terminateSession();
    } finally {
      await client.close();
      if (info) {
        await new Promise<void>((resolve, reject) => info!.server.close((error) => error ? reject(error) : resolve()));
        info.app.getTopicStore().close();
        info.app.getDownloadedStore().close();
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  info = await startServer({ userDataDir: dir, port: 0 });
  const { app } = info;
  app.saveConfig({ ...app.loadConfig(), mcp: { enabled: true } });
  const topics = app.getTopicStore();
  const downloaded = app.getDownloadedStore();
  for (const [topicUrl, hidden, color] of [["visible", 0, null], ["hidden", 1, "#22c55e"]] as const) {
    topics.insert({
      topicUrl, title: `${topicUrl} topic`, hidden, postImage: null, starring: null,
      productionDate: null, duration: null, size: null, torrentUrl: null, sourceForum: null,
      comments: "Preserve notes", tags: [{ name: "Favorite", color }, { name: "Other", color: "blue" }],
    });
  }
  downloaded.insert({
    fileName: "video.mp4", filePath: path.join(dir, "video.mp4"), title: "Video",
    topicUrl: null, postImage: null, cachedImage: null, starring: null, productionDate: null,
    duration: null, size: null, tags: [{ name: "FAVORITE", color: "red" }, { name: "Downloaded only", color: null }],
  });
  const baseUrl = `http://127.0.0.1:${info.port}`;
  transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  await client.connect(transport);
  return { client, topics, downloaded, baseUrl };
}

describe("MCP global tag tools", () => {
  it("advertises all three tools with schemas and global mutation annotations", async (t) => {
    const { client } = await fixture(t);
    const { tools } = await client.listTools();
    const available = tools.find((tool) => tool.name === "get_available_tags");
    const update = tools.find((tool) => tool.name === "update_tag");
    const remove = tools.find((tool) => tool.name === "delete_tag");
    assert.ok(available && update && remove);
    assert.equal(available.annotations?.readOnlyHint, true);
    for (const tool of [update, remove]) {
      assert.equal(tool.annotations?.readOnlyHint, false);
      assert.equal(tool.annotations?.destructiveHint, true);
      assert.equal(tool.annotations?.openWorldHint, false);
      assert.match(tool.description ?? "", /ALL Results and Downloaded/);
      assert.deepEqual(tool.inputSchema.required, ["name"]);
    }
    assert.ok(update.inputSchema.properties?.newName);
    assert.ok(update.inputSchema.properties?.color);
    for (const name of ["get_item_tags", "add_item_tag", "remove_item_tag"]) {
      assert.ok(tools.some((tool) => tool.name === name));
    }
    const { tags } = payload<{ tags: Tag[] }>(await client.callTool({ name: "get_available_tags", arguments: {} }));
    assert.deepEqual(tags, [
      { name: "Downloaded only", color: null }, { name: "FAVORITE", color: "red" }, { name: "Other", color: "blue" },
    ]);
  });

  it("renames, recolors, clears color, and deletes everywhere through a real MCP session", async (t) => {
    const { client, topics, downloaded, baseUrl } = await fixture(t);
    const rename = payload<TagManagementResult>(await client.callTool({
      name: "update_tag", arguments: { name: " favorite ", newName: " Rewatch ", color: "#abcdef" },
    }));
    assert.equal(rename.updatedResults, 2);
    assert.equal(rename.updatedDownloaded, 1);
    for (const item of [...topics.getAll(), ...downloaded.getAll()]) {
      assert.deepEqual(item.tags?.[0], { name: "Rewatch", color: "#abcdef" });
    }
    assert.equal(topics.getByUrl("hidden")?.hidden, 1);
    assert.equal(topics.getByUrl("hidden")?.comments, "Preserve notes");
    const httpList = await fetch(`${baseUrl}/api/config/tags`);
    assert.equal(httpList.status, 200);
    assert.deepEqual(await httpList.json(), { tags: rename.tags });

    payload<TagManagementResult>(await client.callTool({ name: "update_tag", arguments: { name: "rewatch", newName: "REWATCH" } }));
    assert.deepEqual(topics.getByUrl("visible")?.tags?.[0], { name: "REWATCH", color: "#abcdef" });
    payload<TagManagementResult>(await client.callTool({ name: "update_tag", arguments: { name: "REWATCH", color: "#123456" } }));
    assert.deepEqual(downloaded.getById(1)?.tags?.[0], { name: "REWATCH", color: "#123456" });
    payload<TagManagementResult>(await client.callTool({ name: "update_tag", arguments: { name: "rewatch", color: null } }));
    assert.deepEqual(topics.getByUrl("visible")?.tags?.[0], { name: "REWATCH", color: null });
    assert.deepEqual(downloaded.getById(1)?.tags?.[0], { name: "REWATCH", color: null });

    const remove = payload<TagManagementResult>(await client.callTool({ name: "delete_tag", arguments: { name: " rewatch " } }));
    assert.equal(remove.updatedResults, 2);
    assert.equal(remove.updatedDownloaded, 1);
    assert.deepEqual(remove.tags, [{ name: "Downloaded only", color: null }, { name: "Other", color: "blue" }]);
    assert.equal(topics.count(), 2);
    assert.equal(downloaded.getAll().length, 1);
    assert.deepEqual(topics.getByUrl("hidden")?.tags, [{ name: "Other", color: "blue" }]);
    assert.deepEqual(downloaded.getById(1)?.tags, [{ name: "Downloaded only", color: null }]);

    payload(await client.callTool({ name: "add_item_tag", arguments: { item: { type: "result", topicUrl: "visible" }, name: "Single item" } }));
    assert.ok(topics.getByUrl("visible")?.tags?.some((tag) => tag.name === "Single item"));
    assert.ok(!topics.getByUrl("hidden")?.tags?.some((tag) => tag.name === "Single item"));
    payload(await client.callTool({ name: "remove_item_tag", arguments: { item: { type: "result", topicUrl: "visible" }, name: "Single item" } }));
    assert.deepEqual(topics.getByUrl("visible")?.tags, [{ name: "Other", color: "blue" }]);
  });

  it("returns MCP tool errors for duplicates, missing tags, and invalid input without mutations", async (t) => {
    const { client, topics, downloaded } = await fixture(t);
    const beforeTopics = topics.getAll();
    const beforeDownloaded = downloaded.getAll();
    for (const newName of ["other", " DOWNLOADED ONLY "]) {
      const result = await client.callTool({ name: "update_tag", arguments: { name: "favorite", newName } });
      assert.equal(result.isError, true);
      assert.match(toolText(result), /A tag with this name already exists/);
    }
    for (const name of ["update_tag", "delete_tag"]) {
      const result = await client.callTool({ name, arguments: { name: "missing" } });
      assert.equal(result.isError, true);
      assert.match(toolText(result), /Tag not found/);
    }
    const invalidColor = await client.callTool({ name: "update_tag", arguments: { name: "favorite", color: "invalid-color" } });
    assert.equal(invalidColor.isError, true);
    assert.match(toolText(invalidColor), /Invalid tag color/);
    for (const args of [{}, { name: " " }, { name: "favorite", newName: " " }, { name: "favorite", color: 123 }]) {
      const result = await client.callTool({ name: "update_tag", arguments: args });
      assert.equal(result.isError, true);
    }
    assert.deepEqual(topics.getAll(), beforeTopics);
    assert.deepEqual(downloaded.getAll(), beforeDownloaded);
  });
});
