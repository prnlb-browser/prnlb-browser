import * as http from "node:http";
import type { AppContext } from "../server/context.js";
import { json } from "../server/http.js";
import { createMcpEndpoint } from "./server.js";

export interface McpSettings { enabled: boolean; port?: number }

export function normalizeMcpSettings(input: unknown): Required<McpSettings> {
  if (!input || typeof input !== "object") throw new Error("Invalid MCP settings");
  const value = input as Partial<McpSettings>;
  const port = value.port ?? 3002;
  if (typeof value.enabled !== "boolean" || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Use an MCP port from 1024 to 65535.");
  }
  return { enabled: value.enabled, port };
}

export class McpListener {
  readonly endpoint;
  private server: http.Server | null = null;
  private port: number | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(app: AppContext) { this.endpoint = createMcpEndpoint(app); }

  configure(input: unknown): Promise<void> {
    const task = this.queue.then(() => this.apply(normalizeMcpSettings(input)));
    this.queue = task.catch(() => {});
    return task;
  }

  private async apply(settings: Required<McpSettings>): Promise<void> {
    if (!settings.enabled) { await this.close(); return; }
    if (this.server?.listening && this.port === settings.port) return;
    const server = http.createServer((req, res) => {
      // This listener exposes MCP only, never the desktop management API.
      const url = new URL(req.url ?? "/", "http://localhost");
      void this.endpoint.handle({ req, res, url, method: req.method ?? "GET" })
        .then((handled) => { if (!handled) json(res, { error: "Not found" }, 404); })
        .catch(() => { if (!res.headersSent) json(res, { error: "MCP request failed" }, 500); else res.end(); });
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(settings.port, "127.0.0.1", () => {
        server.removeListener("error", onError);
        resolve();
      });
    });
    // Bind the replacement first so a busy port leaves the old listener intact.
    await this.close();
    this.server = server;
    this.port = settings.port;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.port = null;
    await this.endpoint.closeSessions();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}
