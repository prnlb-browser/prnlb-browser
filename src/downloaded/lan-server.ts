import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppContext } from "../core/server/context.js";
import type { Actress, DownloadedItem } from "../core/types.js";
import { json, readBody, serveStatic } from "../core/server/http.js";
import { enrichItemsWithFileStats } from "./scanner.js";
import { getKnownTags } from "../core/known-tags.js";

const SESSION_COOKIE = "downloaded_session";
const SESSION_SECONDS = 12 * 60 * 60;

function secretsEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

const SHARE_SORT_FIELDS = new Set(["fileName", "fileSizeBytes", "starring", "fileBirthtimeMs", "aiRating"]);

function itemCastText(item: { title: string | null; starring: string | null }): string {
  const cast = (item.starring ?? "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  return `${item.title ?? ""} ${cast}`.toLowerCase();
}

function filterAndSortLibrary(items: DownloadedItem[], url: URL, actresses: Actress[]): DownloadedItem[] {
  let filtered = items;
  const query = url.searchParams.get("q")?.trim().toLowerCase();
  if (query) {
    filtered = filtered.filter((item) =>
      [item.fileName, item.title, item.starring, ...(item.tags ?? []).map((tag) => tag.name)]
        .some((value) => value?.toLowerCase().includes(query)),
    );
  }

  const requestedTags = (url.searchParams.get("tags") ?? "").split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  if (requestedTags.length) {
    filtered = filtered.filter((item) => {
      const itemTags = (item.tags ?? []).map((tag) => tag.name.toLowerCase());
      return requestedTags.every((tag) => itemTags.includes(tag));
    });
  }

  const actressFilter = url.searchParams.get("actress") ?? "";
  if (actressFilter) {
    const selected = actressFilter === "fav"
      ? actresses.filter((actress) => actress.isFavorite)
      : actresses.filter((actress) => actress.id === Number(actressFilter));
    filtered = filtered.filter((item) => {
      const haystack = itemCastText(item);
      return selected.some((actress) => [actress.name, ...actress.otherNames]
        .some((name) => haystack.includes(name.toLowerCase())));
    });
  }

  const field = url.searchParams.get("sortBy") ?? "fileBirthtimeMs";
  const sortBy = SHARE_SORT_FIELDS.has(field) ? field : "fileBirthtimeMs";
  const direction = url.searchParams.get("sortDir") === "asc" ? 1 : -1;
  return [...filtered].sort((a, b) => {
    const av = a[sortBy as keyof typeof a];
    const bv = b[sortBy as keyof typeof b];
    const aNull = av === null || av === undefined || av === "";
    const bNull = bv === null || bv === undefined || bv === "";
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * direction;
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * direction;
  });
}

export interface SharingSettings { enabled: boolean; port: number; username: string; accessKey: string }
const mime: Record<string, string> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska",
  ".mov": "video/quicktime", ".avi": "video/x-msvideo", ".mp3": "audio/mpeg",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
};

export function parseByteRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[1] && match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return null;
  end = Math.min(end, size - 1);
  return { start, end };
}

async function streamFile(req: http.IncomingMessage, res: http.ServerResponse, filePath: string, download: boolean): Promise<void> {
  let file;
  try { file = await fs.promises.open(filePath, "r"); } catch { json(res, { error: "File not found" }, 404); return; }
  const stat = await file.stat();
  if (!stat.isFile()) { await file.close(); json(res, { error: "File not found" }, 404); return; }
  const range = req.headers.range ? parseByteRange(req.headers.range, stat.size) : undefined;
  res.setHeader("Accept-Ranges", "bytes");
  if (range === null) {
    await file.close(); res.writeHead(416, { "Content-Range": `bytes */${stat.size}` }); res.end(); return;
  }
  res.setHeader("Content-Type", mime[path.extname(filePath).toLowerCase()] ?? "application/octet-stream");
  if (download) res.setHeader("Content-Disposition", `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(path.basename(filePath)).replace(/'/g, "%27")}`);
  res.setHeader("Content-Length", range ? range.end - range.start + 1 : stat.size);
  if (range) res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
  res.writeHead(range ? 206 : 200);
  if (req.method === "HEAD" || stat.size === 0) { await file.close(); res.end(); return; }
  const stream = file.createReadStream(range || {});
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

export class DownloadedSharing {
  private server: http.Server | null = null;
  private settings: SharingSettings = { enabled: false, port: 3001, username: "share", accessKey: "" };
  private sessionSecret = randomBytes(32);
  private error: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly app: AppContext) {}

  status() {
    const port = this.server?.address();
    const actualPort = port && typeof port === "object" ? port.port : this.settings.port;
    const addresses = Object.values(os.networkInterfaces()).flat().filter((entry) => entry && !entry.internal && entry.family === "IPv4");
    return { ...this.settings, running: !!this.server?.listening, error: this.error,
      urls: this.server?.listening ? addresses.map((entry) => `http://${entry!.address}:${actualPort}`) : [] };
  }

  configure(input: unknown): Promise<void> {
    const task = this.queue.then(() => this.apply(input));
    this.queue = task.catch(() => {});
    return task;
  }

  private async apply(input: unknown): Promise<void> {
    const value = input as Partial<SharingSettings> | null;
    if (!value || typeof value.enabled !== "boolean" || !Number.isInteger(value.port) || value.port! < 1024 || value.port! > 65535 ||
      (value.username !== undefined && typeof value.username !== "string") ||
      (value.accessKey !== undefined && typeof value.accessKey !== "string")) {
      throw new Error("Use a port from 1024 to 65535, and provide text for the username and access key.");
    }
    const next: SharingSettings = {
      enabled: value.enabled,
      port: value.port!,
      username: value.username ?? this.settings.username ?? "share",
      accessKey: value.accessKey || this.settings.accessKey || randomBytes(24).toString("hex"),
    };
    if (next.enabled && this.server?.listening && next.port === this.settings.port) {
      if (next.accessKey !== this.settings.accessKey || next.username !== this.settings.username) {
        this.sessionSecret = randomBytes(32);
        this.server.closeAllConnections();
      }
      this.settings = next; this.error = null; return;
    }
    if (!next.enabled) { this.close(); this.settings = next; this.error = null; return; }
    const server = http.createServer((req, res) => {
      void this.handle(req, res).catch(() => { if (!res.headersSent) json(res, { error: "Unable to serve content" }, 500); else res.destroy(); });
    });
    server.requestTimeout = 30_000;
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(next.port, "0.0.0.0", resolve); }).catch((error: Error) => {
      if (!this.server) this.settings = next;
      this.error = `Could not start sharing: ${error.message}`;
      throw new Error(this.error);
    });
    this.close();
    this.server = server;
    this.settings = next;
    this.error = null;
    server.on("error", (error) => { this.error = error.message; });
  }

  close(): void {
    this.sessionSecret = randomBytes(32);
    this.server?.close();
    this.server?.closeAllConnections();
    this.server = null;
  }

  private validSession(token: string): boolean {
    const match = /^(\d+)\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token);
    if (!match || Number(match[1]) <= Date.now()) return false;
    return secretsEqual(match[3], createHmac("sha256", this.sessionSecret).update(`${match[1]}.${match[2]}`).digest("hex"));
  }

  private loginPage(res: http.ServerResponse, message = "", status = 200): void {
    res.setHeader("Referrer-Policy", "same-origin");
    const template = fs.readFileSync(path.join(this.app.staticDir, "sharing", "login.html"), "utf8");
    // Messages are fixed server text, never request input.
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    res.end(template.replace("<!--login-error-->", message ? `<p class="login-error" role="alert">${message}</p>` : ""));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Native form POSTs can send Origin: null under no-referrer, breaking sign-in.
    // Keep same-origin form metadata while withholding referrers from other sites.
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    const url = new URL(req.url ?? "/", "http://localhost");
    const cookie = (req.headers.cookie ?? "").split(";").map(value => value.trim())
      .find(value => value.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) ?? "";
    const sessionValid = this.validSession(cookie);

    if (url.pathname === "/sharing.css" && (req.method === "GET" || req.method === "HEAD")) {
      if (!serveStatic(res, path.join(this.app.staticDir, "sharing"), "/sharing.css")) json(res, { error: "Not found" }, 404);
      return;
    }
    if (url.pathname === "/login") {
      if (req.method === "GET" || req.method === "HEAD") {
        if (url.searchParams.has("check")) {
          if (sessionValid) { res.writeHead(303, { Location: "/" }); res.end(); return; }
          const fallbackToken = url.searchParams.get("check") ?? "";
          if (this.validSession(fallbackToken)) {
            res.setHeader("Referrer-Policy", "no-referrer");
            res.writeHead(303, { Location: `/session/${fallbackToken}/` }); res.end(); return;
          }
          this.loginPage(res, "Your sign-in has expired. Please sign in again.");
        } else {
          this.loginPage(res);
        }
        return;
      }
      if (req.method === "POST") {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
          this.loginPage(res, "Sign-in was blocked because the browser sent an invalid origin. Reopen the local network address from the desktop app and try again.", 403); return;
        }
        if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
          this.loginPage(res, "The browser sent an unsupported sign-in request. Please use the form below.", 415); return;
        }
        const form = new URLSearchParams(await readBody(req));
        if (!secretsEqual(form.get("username") ?? "", this.settings.username) ||
            !secretsEqual(form.get("password") ?? "", this.settings.accessKey)) {
          this.loginPage(res, "Incorrect username or password. Please try again.", 401); return;
        }
        const payload = `${Date.now() + SESSION_SECONDS * 1000}.${randomBytes(16).toString("hex")}`;
        const signature = createHmac("sha256", this.sessionSecret).update(payload).digest("hex");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.writeHead(303, {
          Location: `/login?check=${payload}.${signature}`,
          "Set-Cookie": `${SESSION_COOKIE}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}; Expires=${new Date(Number(payload.split(".")[0])).toUTCString()}`,
        });
        res.end(); return;
      }
      res.setHeader("Allow", "GET, HEAD, POST"); json(res, { error: "Method not allowed" }, 405); return;
    }
    // Cookie-free browsers carry a signed, expiring session in a local URL prefix.
    const sessionPath = /^\/session\/([^/]+)(\/.*)$/.exec(url.pathname);
    const pathSessionValid = !!sessionPath && this.validSession(sessionPath[1]);
    if (sessionPath) {
      res.setHeader("Referrer-Policy", "no-referrer");
      if (pathSessionValid) url.pathname = sessionPath[2];
      else if (req.method === "GET" && sessionPath[2] === "/") {
        this.loginPage(res, "Your sign-in has expired. Please sign in again.", 401); return;
      }
    }
    const supplied = req.headers.authorization ?? "";
    const expected = `Basic ${Buffer.from(`${this.settings.username}:${this.settings.accessKey}`).toString("base64")}`;
    if (!sessionValid && !pathSessionValid && !secretsEqual(supplied, expected)) {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(303, { Location: "/login" }); res.end();
      } else {
        json(res, { error: "Sign in with the username and access key from the desktop app." }, 401);
      }
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.setHeader("Allow", "GET, HEAD"); json(res, { error: "Read-only library" }, 405); return; }
    if (["/", "/sharing.js", "/sharing.css"].includes(url.pathname)) {
      if (!serveStatic(res, path.join(this.app.staticDir, "sharing"), url.pathname === "/" ? "/index.html" : url.pathname)) json(res, { error: "Not found" }, 404);
      return;
    }
    if (url.pathname === "/library") {
      const items = enrichItemsWithFileStats(this.app.getDownloadedStore().getAll());
      const actresses = typeof this.app.getActressStore === "function" ? this.app.getActressStore().getAll() : [];
      const filtered = filterAndSortLibrary(items, url, actresses);
      json(res, filtered.map((item) => ({ id: item.id, fileName: item.fileName, title: item.title, starring: item.starring,
        tags: item.tags, duration: item.duration, hasImage: !!item.cachedImage }))); return;
    }
    if (url.pathname === "/filters") {
      json(res, {
        actresses: this.app.getActressStore().getAll().map(({ id, name, otherNames, isFavorite }) => ({ id, name, otherNames, isFavorite })),
        tags: getKnownTags(this.app).map((tag) => tag.name),
      });
      return;
    }
    const match = /^\/items\/(\d+)\/(file|image)$/.exec(url.pathname);
    if (match) {
      const item = this.app.getDownloadedStore().getById(Number(match[1]));
      if (!item) { json(res, { error: "Item not found" }, 404); return; }
      if (match[2] === "file") { await streamFile(req, res, item.filePath, url.searchParams.has("download")); return; }
      if (item.cachedImage && path.basename(item.cachedImage) === item.cachedImage) {
        const directory = path.join(path.dirname(item.filePath), ".images");
        const image = path.join(directory, item.cachedImage);
        const [root, real] = await Promise.all([fs.promises.realpath(directory), fs.promises.realpath(image)]).catch(() => ["", ""]);
        if (root && real.startsWith(root + path.sep)) { await streamFile(req, res, real, false); return; }
      }
    }
    json(res, { error: "Not found" }, 404);
  }
}
