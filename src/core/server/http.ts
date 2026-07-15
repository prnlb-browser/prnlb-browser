import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

export type SseEmitter = (data: unknown) => void;

export function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  return JSON.parse(await readBody(req)) as T;
}

export function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function startSse(res: http.ServerResponse): SseEmitter {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  return (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    const flushable = res as http.ServerResponse & { flush?: () => void };
    flushable.flush?.();
  };
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export function serveStatic(res: http.ServerResponse, staticDir: string, requestPath: string): boolean {
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const fullPath = path.resolve(staticDir, relativePath);
  const root = path.resolve(staticDir) + path.sep;
  if (!fullPath.startsWith(root) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) return false;

  const content = fs.readFileSync(fullPath);
  res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(fullPath)] ?? "application/octet-stream" });
  res.end(content);
  return true;
}
