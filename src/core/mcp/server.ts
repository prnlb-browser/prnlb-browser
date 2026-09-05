import { randomUUID } from "node:crypto";
import type * as http from "node:http";
import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { AppContext } from "../server/context.js";
import type { DownloadedItem, ItemRef, NavigateDestination, TopicData } from "../types.js";
import { normalizeTags, type Tag } from "../tags.js";
import { enrichItemsWithFileStats } from "../../downloaded/scanner.js";
import { searchPornolab, type SearchResult } from "../../search/scraper.js";
import { runCrawl } from "../../crawl/service.js";
import { scrapeTopicImages } from "../images/topic-scraper.js";
import { fetchImageBytes } from "../images/fetch-bytes.js";
import { resolverRegistry } from "../images/registry.js";
import { scaleImagesForAnalysis } from "../images/resize.js";
import { downloadAndCacheImage } from "../images/downloader.js";
import { prepareImagesDirectory } from "../../downloaded/scanner.js";
import { validateFolderPath } from "../fs-paths.js";
import type { TopicSort } from "../../results/store.js";

const itemRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("result"), topicUrl: z.string().min(1) }),
  z.object({ type: z.literal("downloaded"), id: z.number().int().positive() }),
]);

const pageSchema = {
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(500).default(100),
};

type Session = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

type SearchSession = {
  result: SearchResult;
  createdAt: number;
};

function textResult(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function page<T>(items: T[], offset: number, limit: number): { items: T[]; offset: number; limit: number; total: number } {
  return { items: items.slice(offset, offset + limit), offset, limit, total: items.length };
}

export function sampleItems<T>(items: T[], every: number, offset: number, limit: number): T[] {
  return items.filter((_item, index) => {
    const position = index + 1;
    return position > offset && (position - offset) % every === 0;
  }).slice(0, limit);
}

function getItem(app: AppContext, item: ItemRef): TopicData | DownloadedItem | undefined {
  if (item.type === "result") return app.getTopicStore().getByUrl(item.topicUrl);
  const found = app.getDownloadedStore().getById(item.id);
  return found ? enrichItemsWithFileStats([found])[0] : undefined;
}

function requireItem(app: AppContext, item: ItemRef): TopicData | DownloadedItem {
  const found = getItem(app, item);
  if (!found) throw new Error("Item not found");
  return found;
}

function updateItemTags(app: AppContext, item: ItemRef, tags: Tag[]): TopicData | DownloadedItem {
  if (item.type === "result") {
    const store = app.getTopicStore();
    if (!store.updateTags(item.topicUrl, tags)) throw new Error("Item not found");
  } else if (!app.getDownloadedStore().updateTags(item.id, tags)) {
    throw new Error("Item not found");
  }
  return requireItem(app, item);
}

function sortDownloaded(items: DownloadedItem[], sortBy: string, sortDir: "asc" | "desc"): DownloadedItem[] {
  const direction = sortDir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortBy];
    const bv = (b as unknown as Record<string, unknown>)[sortBy];
    const aNull = av === null || av === undefined || av === "";
    const bNull = bv === null || bv === undefined || bv === "";
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * direction;
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * direction;
  });
}

function actressImagesDir(app: AppContext): string {
  const validation = validateFolderPath(app.loadConfig().downloadedFolder);
  return prepareImagesDirectory(validation.ok ? validation.absolutePath : app.userDataDir);
}

function registerTools(server: McpServer, app: AppContext, searches: Map<string, SearchSession>): void {
  server.registerTool("crawl", {
    description: "Crawl configured Pornolab forums and save new result topics.",
  }, async (extra) => {
    if (app.crawl.isRunning) throw new Error("Crawl is already running");
    await server.sendLoggingMessage({ level: "info", data: "Crawl started" }, extra.sessionId);
    await runCrawl(app);
    return textResult({ running: app.crawl.isRunning, progress: app.crawl.lastProgress, items: app.crawl.lastResults ?? [] });
  });

  server.registerTool("get_crawl_status", {
    description: "Get the current crawl state and most recent progress event.",
  }, async () => textResult({
    running: app.crawl.isRunning,
    progress: app.crawl.lastProgress,
    hasResults: app.crawl.lastResults !== null,
    lastCrawlCount: app.crawl.lastResults?.length ?? 0,
    dbTotal: app.getTopicStore().count(),
  }));

  server.registerTool("get_results_items", {
    description: "List saved result topics with optional text, forum, tag, sorting, and pagination filters.",
    inputSchema: {
      query: z.string().optional(), forum: z.string().optional(), tags: z.array(z.string()).default([]),
      sortBy: z.enum(["createdAt", "aiRating", "size", "starring"]).default("createdAt"),
      sortDir: z.enum(["asc", "desc"]).default("desc"), ...pageSchema,
    },
  }, async ({ query, forum, tags, sortBy, sortDir, offset, limit }) => {
    const store = app.getTopicStore();
    const sort: TopicSort = { by: sortBy, dir: sortDir };
    let items = query && forum ? store.searchByForum(query, forum, sort) : forum ? store.getByForum(forum, sort) : query ? store.search(query, sort) : store.getAll(sort);
    const required = tags.map((tag) => tag.toLowerCase());
    if (required.length) items = items.filter((item) => required.every((tag) => (item.tags ?? []).some((candidate) => candidate.name.toLowerCase() === tag)));
    return textResult(page(items, offset, limit));
  });

  server.registerTool("search", {
    description: "Search Pornolab and create a temporary search result session.",
    inputSchema: { query: z.string().min(1), forums: z.array(z.number().int()).optional(), start: z.number().int().nonnegative().default(0) },
  }, async ({ query, forums, start }, extra) => {
    const result = await searchPornolab(app.loadConfig(), { query, forums, start }, (progress) => {
      void server.sendLoggingMessage({ level: progress.phase === "error" ? "error" : "info", data: progress.message }, extra.sessionId);
    });
    const searchId = randomUUID();
    searches.set(searchId, { result, createdAt: Date.now() });
    return textResult({ searchId, items: result.results, pagination: result.pagination });
  });

  server.registerTool("get_search_items", {
    description: "Read items from a previous temporary search session.",
    inputSchema: { searchId: z.string().min(1), ...pageSchema },
  }, async ({ searchId, offset, limit }) => {
    const session = searches.get(searchId);
    if (!session || Date.now() - session.createdAt > 30 * 60 * 1000) throw new Error("Search session not found or expired");
    return textResult({ ...page(session.result.results, offset, limit), pagination: session.result.pagination });
  });

  server.registerTool("get_downloaded_items", {
    description: "List downloaded files with optional text, tag, sorting, and pagination filters.",
    inputSchema: {
      query: z.string().optional(), tags: z.array(z.string()).default([]),
      sortBy: z.enum(["fileName", "fileSizeBytes", "starring", "fileBirthtimeMs", "aiRating"]).default("fileBirthtimeMs"),
      sortDir: z.enum(["asc", "desc"]).default("desc"), ...pageSchema,
    },
  }, async ({ query, tags, sortBy, sortDir, offset, limit }) => {
    let items = enrichItemsWithFileStats(app.getDownloadedStore().getAll());
    if (query) {
      const needle = query.toLowerCase();
      items = items.filter((item) => [item.fileName, item.title, item.starring, ...(item.tags ?? []).map((tag) => tag.name)].some((value) => value?.toLowerCase().includes(needle)));
    }
    const required = tags.map((tag) => tag.toLowerCase());
    if (required.length) items = items.filter((item) => required.every((tag) => (item.tags ?? []).some((candidate) => candidate.name.toLowerCase() === tag)));
    return textResult(page(sortDownloaded(items, sortBy, sortDir), offset, limit));
  });

  server.registerTool("get_item_details", {
    description: "Get one saved result topic or downloaded file.", inputSchema: { item: itemRefSchema },
  }, async ({ item }) => textResult(requireItem(app, item)));

  server.registerTool("edit_item_details", {
    description: "Edit user-maintained details on a result topic or downloaded file.",
    inputSchema: {
      item: itemRefSchema,
      fields: z.object({ title: z.string().nullable().optional(), postImage: z.string().nullable().optional(), topicUrl: z.string().nullable().optional(), starring: z.string().nullable().optional(), productionDate: z.string().nullable().optional(), duration: z.string().nullable().optional(), size: z.string().nullable().optional(), comments: z.string().nullable().optional() }).partial(),
    },
  }, async ({ item, fields }) => {
    requireItem(app, item);
    if (item.type === "result") {
      const { topicUrl: _topicUrl, ...resultFields } = fields;
      const safeFields: Partial<Pick<TopicData, "title" | "postImage" | "starring" | "productionDate" | "duration" | "size" | "comments">> = {};
      for (const key of ["title", "postImage", "starring", "productionDate", "duration", "size", "comments"] as const) {
        const value = resultFields[key];
        if (value === undefined || (key === "title" && value === null)) continue;
        if (key === "title" && typeof value === "string") safeFields.title = value;
        else if (key === "postImage") safeFields.postImage = value;
        else if (key === "starring") safeFields.starring = value;
        else if (key === "productionDate") safeFields.productionDate = value;
        else if (key === "duration") safeFields.duration = value;
        else if (key === "size") safeFields.size = value;
        else safeFields.comments = value;
      }
      app.getTopicStore().updateItem(item.topicUrl, safeFields);
    } else {
      app.getDownloadedStore().updateItem(item.id, fields);
    }
    return textResult(requireItem(app, item));
  });

  server.registerTool("get_item_screens", {
    description: "Return scaled screenshot images for AI analysis. Images are returned as MCP image content.",
    inputSchema: { item: itemRefSchema, maxDimension: z.number().int().min(64).max(2000).default(600), every: z.number().int().min(1).default(1), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(50).default(20) },
  }, async ({ item, maxDimension, every, offset, limit }, extra) => {
    const details = requireItem(app, item);
    const topicUrl = details.topicUrl;
    if (!topicUrl) throw new Error("This item has no topic URL");
    const scraped = await scrapeTopicImages(topicUrl, (progress) => {
      void server.sendLoggingMessage({ level: "info", data: progress.message }, extra.sessionId);
    });
    const sampled = sampleItems(scraped, every, offset, limit);
    const resolved = await resolverRegistry.resolveImages(sampled, (progress) => {
      void server.sendLoggingMessage({ level: "info", data: progress.message }, extra.sessionId);
    });
    const imageBytes: Buffer[] = [];
    const imageMetadata: Array<{ image: typeof resolved[number]; bytes: Buffer }> = [];
    for (const image of resolved) {
      const bytes = await fetchImageBytes(image.resolvedUrl);
      if (!bytes) continue;
      imageBytes.push(bytes);
      imageMetadata.push({ image, bytes });
    }
    const scaledImages = await scaleImagesForAnalysis(imageBytes, maxDimension);
    const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
    const metadata: Array<Record<string, unknown>> = [];
    for (let index = 0; index < scaledImages.length; index++) {
      const scaled = scaledImages[index]!;
      const image = imageMetadata[index]!.image;
      metadata.push({ index: index + 1, originalUrl: image.originalUrl, resolvedUrl: image.resolvedUrl, width: scaled.width, height: scaled.height });
      content.push({ type: "image", data: scaled.bytes.toString("base64"), mimeType: scaled.mimeType });
    }
    content.unshift({ type: "text", text: JSON.stringify({ item, maxDimension, every, offset, images: metadata, totalFound: scraped.length }) });
    return { content };
  });

  server.registerTool("get_item_tags", {
    description: "Get tags assigned to an item.", inputSchema: { item: itemRefSchema },
  }, async ({ item }) => textResult({ item, tags: requireItem(app, item).tags ?? [] }));

  server.registerTool("add_item_tag", {
    description: "Add a tag to an item, optionally with a CSS color.", inputSchema: { item: itemRefSchema, name: z.string().min(1), color: z.string().nullable().optional() },
  }, async ({ item, name, color }) => {
    const current = requireItem(app, item).tags ?? [];
    const tags = normalizeTags([...current, { name, color: color ?? null }]);
    return textResult({ item: updateItemTags(app, item, tags), tags });
  });

  server.registerTool("remove_item_tag", {
    description: "Remove a tag from an item by case-insensitive name.", inputSchema: { item: itemRefSchema, name: z.string().min(1) },
  }, async ({ item, name }) => {
    const tags = (requireItem(app, item).tags ?? []).filter((tag) => tag.name.toLowerCase() !== name.toLowerCase());
    return textResult({ item: updateItemTags(app, item, tags), tags });
  });

  server.registerTool("set_item_rate", {
    description: "Set or clear an item's 0-100 rating.", inputSchema: { item: itemRefSchema, rate: z.number().min(0).max(100).nullable() },
  }, async ({ item, rate }) => {
    const ok = item.type === "result" ? app.getTopicStore().setRating(item.topicUrl, rate) : app.getDownloadedStore().setRating(item.id, rate);
    if (!ok) throw new Error("Item not found");
    return textResult(requireItem(app, item));
  });

  server.registerTool("get_item_rate", {
    description: "Get an item's 0-100 rating.", inputSchema: { item: itemRefSchema },
  }, async ({ item }) => textResult({ item, rate: requireItem(app, item).aiRating ?? null }));

  server.registerTool("get_actresses", {
    description: "List actresses in the local catalogue.", inputSchema: { query: z.string().optional(), favoriteOnly: z.boolean().default(false), ...pageSchema },
  }, async ({ query, favoriteOnly, offset, limit }) => {
    let actresses = app.getActressStore().getAll();
    if (query) actresses = actresses.filter((actress) => [actress.name, ...actress.otherNames].some((name) => name.toLowerCase().includes(query.toLowerCase())));
    if (favoriteOnly) actresses = actresses.filter((actress) => actress.isFavorite);
    return textResult(page(actresses, offset, limit));
  });

  server.registerTool("get_actress_details", {
    description: "Get one actress from the local catalogue.", inputSchema: { id: z.number().int().positive() },
  }, async ({ id }) => {
    const actress = app.getActressStore().getById(id);
    if (!actress) throw new Error("Actress not found");
    return textResult(actress);
  });

  server.registerTool("edit_actress_details", {
    description: "Edit an actress's name, aliases, image URL, or favorite state.", inputSchema: { id: z.number().int().positive(), name: z.string().optional(), otherNames: z.array(z.string()).optional(), postImageUrl: z.string().nullable().optional(), isFavorite: z.boolean().optional() },
  }, async ({ id, name, otherNames, postImageUrl, isFavorite }) => {
    const actress = app.getActressStore().getById(id);
    if (!actress) throw new Error("Actress not found");
    const fields: { name?: string; otherNames?: string[]; postImage?: string | null; cachedImage?: string | null; isFavorite?: boolean } = {};
    if (name !== undefined) fields.name = name;
    if (otherNames !== undefined) fields.otherNames = otherNames;
    if (isFavorite !== undefined) fields.isFavorite = isFavorite;
    if (postImageUrl !== undefined) {
      const imageUrl = postImageUrl?.trim() ? postImageUrl.trim() : null;
      fields.postImage = imageUrl;
      fields.cachedImage = imageUrl
        ? await downloadAndCacheImage(imageUrl, `actress-${id}`, actressImagesDir(app))
        : null;
    }
    app.getActressStore().updateItem(id, fields);
    return textResult(app.getActressStore().getById(id));
  });

  server.registerTool("new_actress", {
    description: "Create an actress in the local catalogue.", inputSchema: { name: z.string().min(1), otherNames: z.array(z.string()).default([]), postImageUrl: z.string().nullable().optional() },
  }, async ({ name, otherNames, postImageUrl }) => {
    const created = app.getActressStore().insert({ name, otherNames });
    const imageUrl = postImageUrl?.trim() ? postImageUrl.trim() : null;
    if (imageUrl) {
      const cachedImage = await downloadAndCacheImage(imageUrl, `actress-${created.id}`, actressImagesDir(app));
      app.getActressStore().updateItem(created.id, { postImage: imageUrl, cachedImage });
    }
    return textResult(app.getActressStore().getById(created.id));
  });

  server.registerTool("navigate_to_item", {
    description: "Open an item's topic, file, containing folder, or the relevant place in the Electron app.", inputSchema: { item: itemRefSchema, destination: z.enum(["topic", "file", "folder", "app"]) },
  }, async ({ item, destination }) => {
    requireItem(app, item);
    await app.navigateToItem(item, destination as NavigateDestination);
    return textResult({ item, destination, success: true });
  });
}

export class McpEndpoint {
  private readonly sessions = new Map<string, Session>();
  private readonly searches = new Map<string, SearchSession>();
  private wasEnabled = false;

  constructor(private readonly app: AppContext) {}

  async handle(context: { req: http.IncomingMessage; res: http.ServerResponse; url: URL; method: string }): Promise<boolean> {
    if (context.url.pathname !== "/mcp") return false;
    const enabled = this.app.loadConfig().mcp.enabled;
    if (!enabled) {
      if (this.wasEnabled) await this.closeSessions();
      this.wasEnabled = false;
      context.res.writeHead(404, { "Content-Type": "application/json" });
      context.res.end(JSON.stringify({ error: "MCP is disabled" }));
      return true;
    }
    this.wasEnabled = true;

    if (context.method === "POST") {
      const sessionId = typeof context.req.headers["mcp-session-id"] === "string" ? context.req.headers["mcp-session-id"] : undefined;
      const existing = sessionId ? this.sessions.get(sessionId) : undefined;
      if (existing) {
        await existing.transport.handleRequest(context.req, context.res);
        return true;
      }
      const body = await readRequestJson(context.req);
      if (!isInitializeRequest(body)) {
        context.res.writeHead(400, { "Content-Type": "application/json" });
        context.res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "A valid MCP session is required" }, id: null }));
        return true;
      }
      let session: Session;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (initializedSessionId) => {
          this.sessions.set(initializedSessionId, session);
        },
      });
      const server = new McpServer({ name: "prnlb-browser", version: "2.1.0" });
      registerTools(server, this.app, this.searches);
      session = { server, transport };
      transport.onclose = () => {
        if (transport.sessionId) this.sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      await transport.handleRequest(context.req, context.res, body);
      return true;
    }

    const sessionId = typeof context.req.headers["mcp-session-id"] === "string" ? context.req.headers["mcp-session-id"] : undefined;
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session) {
      context.res.writeHead(404, { "Content-Type": "application/json" });
      context.res.end(JSON.stringify({ error: "MCP session not found" }));
      return true;
    }
    await session.transport.handleRequest(context.req, context.res);
    return true;
  }

  private async closeSessions(): Promise<void> {
    await Promise.all([...this.sessions.values()].map(async ({ server, transport }) => {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    }));
    this.sessions.clear();
  }
}

async function readRequestJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export function createMcpEndpoint(app: AppContext): McpEndpoint {
  return new McpEndpoint(app);
}
