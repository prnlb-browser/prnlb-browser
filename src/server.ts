import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { crawl } from "./scraper.js";
import { createTopicStore, type TopicStore } from "./db.js";
import type { Config, TopicData, CrawlProgress } from "./types.js";
import { resolverRegistry } from "./resolvers/registry.js";
import { scrapeTopicImages } from "./resolvers/topic-scraper.js";
import { searchPornolab, fetchForumOptions, fetchTopicDetails } from "./search-scraper.js";
import { submitCaptchaCode } from "./captcha-handler.js";

// --- State ---

let currentConfig: Config | null = null;
let db: TopicStore | null = null;
let isRunning = false;
let lastProgress: CrawlProgress | null = null;
let lastResults: TopicData[] | null = null;
let progressListeners: ((p: CrawlProgress) => void)[] = [];
let staticDir: string = path.resolve(__dirname, "../../public");
let userDataDir: string = process.cwd();

// --- Config ---

function getConfigPath(): string {
  return path.join(userDataDir, "config.json");
}

function getDefaultConfig(): Config {
  return {
    credentials: { username: "", password: "" },
    forums: [],
    pagesToScan: 2,
    headless: true,
    outputFile: "output.json",
    delay: { min: 2000, max: 5000 },
    dbPath: "data.db",
    favActresses: [],
  };
}

function loadConfig(): Config {
  try {
    const raw = fs.readFileSync(getConfigPath(), "utf-8");
    return JSON.parse(raw) as Config;
  } catch {
    // No config yet — return defaults
    return getDefaultConfig();
  }
}

function saveConfig(config: Config): void {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
  currentConfig = config;
}

function getDb(): TopicStore {
  if (!db) {
    const config = currentConfig ?? loadConfig();
    const dbPath = path.isAbsolute(config.dbPath)
      ? config.dbPath
      : path.join(userDataDir, config.dbPath);
    db = createTopicStore(dbPath);
  }
  return db;
}

// --- Helpers ---

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// --- Static files ---

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveStatic(res: http.ServerResponse, filePath: string): boolean {
  const fullPath = path.join(staticDir, filePath === "/" ? "index.html" : filePath);
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) return false;
  const ext = path.extname(fullPath);
  const mime = MIME_TYPES[ext] ?? "application/octet-stream";
  const content = fs.readFileSync(fullPath);
  res.writeHead(200, { "Content-Type": mime });
  res.end(content);
  return true;
}

// --- SSE for progress ---

function handleSSE(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Send current state immediately
  if (lastProgress) {
    res.write(`data: ${JSON.stringify(lastProgress)}\n\n`);
  }
  if (!isRunning) {
    res.write(`data: ${JSON.stringify({ phase: "idle", message: "Ready" })}\n\n`);
  }

  const listener = (p: CrawlProgress) => {
    res.write(`data: ${JSON.stringify(p)}\n\n`);
  };
  progressListeners.push(listener);

  req.on("close", () => {
    progressListeners = progressListeners.filter((l) => l !== listener);
  });
}

// --- Start crawl ---

async function startCrawl(config: Config, res: http.ServerResponse): Promise<void> {
  if (isRunning) {
    json(res, { error: "Crawl is already running" }, 409);
    return;
  }

  isRunning = true;
  lastProgress = null;
  lastResults = null;
  json(res, { message: "Crawl started" });

  const store = getDb();
  const existingUrls = new Set(store.getAll().map((t) => t.topicUrl));

  const onProgress = (p: CrawlProgress) => {
    lastProgress = p;
    for (const listener of progressListeners) listener(p);
  };

  try {
    const { results: crawled, skipped: preFiltered } = await crawl(config, onProgress, existingUrls);
    const { inserted, skipped: dbSkipped } = store.insertMany(crawled);
    lastResults = crawled;
    const totalSkipped = preFiltered + dbSkipped;
    onProgress({
      phase: "done",
      message: `Done — ${inserted} new, ${totalSkipped} skipped (already in DB), ${crawled.length + totalSkipped} total processed`,
    });
  } catch (err) {
    onProgress({ phase: "error", message: (err as Error).message });
  } finally {
    isRunning = false;
  }
}

// --- Route handler ---

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const method = req.method ?? "GET";

  try {
    // --- API routes ---

    // GET /api/config
    if (url.pathname === "/api/config" && method === "GET") {
      const config = currentConfig ?? loadConfig();
      json(res, config);
      return;
    }

    // PUT /api/config
    if (url.pathname === "/api/config" && method === "PUT") {
      const body = await readBody(req);
      const config = JSON.parse(body) as Config;
      saveConfig(config);
      json(res, { message: "Config saved" });
      return;
    }

    // POST /api/crawl
    if (url.pathname === "/api/crawl" && method === "POST") {
      const config = currentConfig ?? loadConfig();
      await startCrawl(config, res);
      return;
    }

    // GET /api/status
    if (url.pathname === "/api/status" && method === "GET") {
      const store = getDb();
      json(res, {
        running: isRunning,
        progress: lastProgress,
        hasResults: lastResults !== null,
        lastCrawlCount: lastResults?.length ?? 0,
        dbTotal: store.count(),
      });
      return;
    }

    // GET /api/forums — returns distinct source forums that have results in DB
    if (url.pathname === "/api/forums" && method === "GET") {
      const store = getDb();
      json(res, store.getDistinctForums());
      return;
    }

    // GET /api/results — returns all topics from DB (newest first)
    if (url.pathname === "/api/results" && method === "GET") {
      const store = getDb();
      const q = url.searchParams.get("q");
      const forum = url.searchParams.get("forum");
      let results: TopicData[];
      if (q && forum) {
        results = store.searchByForum(q, forum);
      } else if (forum) {
        results = store.getByForum(forum);
      } else if (q) {
        results = store.search(q);
      } else {
        results = store.getAll();
      }
      json(res, results);
      return;
    }

    // PATCH /api/results/hide — toggle hidden flag for a topic
    if (url.pathname === "/api/results/hide" && method === "PATCH") {
      const body = await readBody(req);
      const { topicUrl } = JSON.parse(body) as { topicUrl: string };
      if (!topicUrl) {
        json(res, { error: "topicUrl is required" }, 400);
        return;
      }
      const store = getDb();
      const hidden = store.toggleHidden(topicUrl);
      json(res, { topicUrl, hidden });
      return;
    }

    // DELETE /api/results — clear all topics from DB
    if (url.pathname === "/api/results" && method === "DELETE") {
      const store = getDb();
      const deleted = store.clearAll();
      json(res, { message: `Deleted ${deleted} topics` });
      return;
    }

    // POST /api/results/add — add a single topic to DB
    if (url.pathname === "/api/results/add" && method === "POST") {
      const body = await readBody(req);
      const topic = JSON.parse(body) as TopicData;
      if (!topic.topicUrl) {
        json(res, { error: "topicUrl is required" }, 400);
        return;
      }
      const store = getDb();
      const inserted = store.insert(topic);
      json(res, { inserted, topicUrl: topic.topicUrl });
      return;
    }

    // POST /api/search — search pornolab tracker
    if (url.pathname === "/api/search" && method === "POST") {
      const body = await readBody(req);
      const { query, forums: forumIds, start } = JSON.parse(body) as {
        query: string;
        forums?: number[];
        start?: number;
      };
      if (!query) {
        json(res, { error: "query is required" }, 400);
        return;
      }
      const config = currentConfig ?? loadConfig();

      // SSE stream for progress
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.flushHeaders();

      const emit = (data: object) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        // @ts-ignore
        if (typeof (res as any).flush === "function") (res as any).flush();
      };

      try {
        const result = await searchPornolab(
          config,
          { query, forums: forumIds, start },
          (p) => emit(p),
        );
        emit({ phase: "results", data: result.results, pagination: result.pagination });
      } catch (err) {
        emit({ phase: "error", message: (err as Error).message });
      }
      res.end();
      return;
    }

    // GET /api/topic/details?url=... — fetch post image + metadata from a topic page (SSE stream)
    if (url.pathname === "/api/topic/details" && method === "GET") {
      const topicUrl = url.searchParams.get("url");
      if (!topicUrl) {
        json(res, { error: "url is required" }, 400);
        return;
      }
      const config = currentConfig ?? loadConfig();

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.flushHeaders();

      const emit = (data: object) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        // @ts-ignore
        if (typeof (res as any).flush === "function") (res as any).flush();
      };

      try {
        const details = await fetchTopicDetails(topicUrl, config, (p) => emit(p));
        emit({ phase: "result", data: details });
      } catch (err) {
        emit({ phase: "error", message: (err as Error).message });
      }
      res.end();
      return;
    }

    // GET /api/search/forums — get available forum filters from tracker page (SSE stream)
    if (url.pathname === "/api/search/forums" && method === "GET") {
      const config = currentConfig ?? loadConfig();

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.flushHeaders();

      const emit = (data: object) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        // @ts-ignore
        if (typeof (res as any).flush === "function") (res as any).flush();
      };

      try {
        const forums = await fetchForumOptions(config, (p) => emit(p));
        emit({ phase: "result", data: forums });
      } catch (err) {
        emit({ phase: "error", message: (err as Error).message });
      }
      res.end();
      return;
    }

    // POST /api/captcha — submit captcha code
    if (url.pathname === "/api/captcha" && method === "POST") {
      const body = await readBody(req);
      const { captchaId, code } = JSON.parse(body) as { captchaId: string; code: string };
      if (!captchaId || !code) {
        json(res, { error: "captchaId and code are required" }, 400);
        return;
      }
      const ok = submitCaptchaCode(captchaId, code);
      json(res, { success: ok });
      return;
    }

    // POST /api/topic/images — scrape topic page and resolve images (SSE stream)
    if (url.pathname === "/api/topic/images" && method === "POST") {
      const body = await readBody(req);
      const { topicUrl } = JSON.parse(body) as { topicUrl: string };
      if (!topicUrl) {
        json(res, { error: "topicUrl is required" }, 400);
        return;
      }

      // Stream SSE progress events
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.flushHeaders();

      const emit = (data: object) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        // Explicitly flush so the browser receives each event immediately
        // @ts-ignore — flush exists on ServerResponse in Node 18+
        if (typeof (res as any).flush === "function") (res as any).flush();
      };

      try {
        // 1. Scrape topic for images (returns thumbnail + resolve URL pairs)
        const scrapedImages = await scrapeTopicImages(topicUrl, (p) => emit(p));

        // 2. Filter only images whose resolveUrl has a matching resolver
        const handledImages = scrapedImages.filter((img) => resolverRegistry.findResolver(img.resolveUrl));

        if (handledImages.length === 0) {
          emit({ phase: "done", images: [], total: scrapedImages.length, resolved: 0 });
          res.end();
          return;
        }

        // 3. Resolve each image to its full-size version
        const resolved = await resolverRegistry.resolveImages(handledImages, (p) => emit(p));

        emit({ phase: "done", images: resolved, total: scrapedImages.length, resolved: resolved.length });
      } catch (err) {
        emit({ phase: "error", message: (err as Error).message });
      }

      res.end();
      return;
    }

    // GET /api/events (SSE)
    if (url.pathname === "/api/events" && method === "GET") {
      handleSSE(req, res);
      return;
    }

    // --- Static files ---
    if (serveStatic(res, url.pathname)) return;

    // 404
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  } catch (err) {
    console.error("Request error:", err);
    json(res, { error: "Internal server error" }, 500);
  }
}

// --- Exported start function (used by both CLI server and Electron) ---

export interface ServerInfo {
  server: http.Server;
  port: number;
}

export function startServer(opts?: { staticDir?: string; userDataDir?: string; port?: number }): Promise<ServerInfo> {
  return new Promise((resolve, reject) => {
    if (opts?.staticDir) staticDir = opts.staticDir;
    if (opts?.userDataDir) userDataDir = opts.userDataDir;

    const port = opts?.port ?? parseInt(process.env.PORT ?? "3000", 10);

    // Pre-load config
    try {
      currentConfig = loadConfig();
      console.log("✅ Config loaded from", getConfigPath());
    } catch {
      console.log("⚠️  No config.json found — configure via web UI");
    }

    const server = http.createServer(handleRequest);

    server.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      console.log(`\n🌐 Server running at http://localhost:${actualPort}`);
      resolve({ server, port: actualPort });
    });

    server.on("error", reject);
  });
}

// --- Direct execution ---

const isMainModule = process.argv[1] && (process.argv[1] === __filename || process.argv[1].endsWith("/server.js") || process.argv[1].endsWith("\\server.js"));
if (isMainModule) {
  startServer().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
