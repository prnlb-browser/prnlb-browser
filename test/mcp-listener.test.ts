import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startServer } from "../src/core/server/index.js";
import { normalizeMcpSettings } from "../src/core/mcp/listener.js";

async function reservePort() {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, port: address.port };
}
async function close(server: http.Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test("MCP settings backfill old configs and reject invalid ports", () => {
  assert.deepEqual(normalizeMcpSettings({ enabled: false }), { enabled: false, port: 3002 });
  for (const port of [0, 1023, 65536, 3002.5, "3002", NaN]) {
    assert.throws(() => normalizeMcpSettings({ enabled: true, port }));
  }
});

test("MCP port changes bind a dedicated listener, preserve busy-port failures, and stop when disabled", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-mcp-port-"));
  const appServer = await startServer({ userDataDir: directory, port: 0 });
  const occupied = await reservePort();
  const free = await reservePort();
  await close(free.server);
  const origin = `http://127.0.0.1:${appServer.port}`;
  const save = async (enabled: boolean, port: number) => fetch(`${origin}/api/config`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...appServer.app.loadConfig(), mcp: { enabled, port } }),
  });
  try {
    assert.equal((await save(true, free.port)).status, 200);
    const mcpOrigin = `http://127.0.0.1:${free.port}`;
    const client = new Client({ name: "port-test", version: "1.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${mcpOrigin}/mcp`)));
      assert.ok((await client.listTools()).tools.some((tool) => tool.name === "get_available_tags"));
    } finally { await client.close(); }
    // MCP rejects an unknown session; desktop APIs are not exposed here.
    assert.equal((await fetch(`${mcpOrigin}/mcp`)).status, 404);
    assert.equal((await fetch(`${mcpOrigin}/api/config`)).status, 404);
    assert.equal((await save(true, occupied.port)).status, 400);
    assert.equal(appServer.app.loadConfig().mcp.port, free.port);
    assert.equal((await fetch(`${mcpOrigin}/mcp`)).status, 404);
    await close(occupied.server);
    assert.equal((await save(true, occupied.port)).status, 200);
    await assert.rejects(fetch(`${mcpOrigin}/mcp`));
    const changedOrigin = `http://127.0.0.1:${occupied.port}`;
    assert.equal((await fetch(`${changedOrigin}/api/config`)).status, 404);
    assert.equal((await save(false, occupied.port)).status, 200);
    await assert.rejects(fetch(`${changedOrigin}/mcp`));
    const persisted = JSON.parse(fs.readFileSync(path.join(directory, "config.json"), "utf8"));
    assert.deepEqual(persisted.mcp, { enabled: false, port: occupied.port });
  } finally {
    await appServer.app.mcp.close();
    await close(appServer.server);
    if (occupied.server.listening) await close(occupied.server);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
