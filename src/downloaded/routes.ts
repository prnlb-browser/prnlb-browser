import * as fs from "node:fs";
import * as path from "node:path";
import type { RouteHandler } from "../core/server/router.js";
import { json, readJson, startSse } from "../core/server/http.js";
import { fetchTopicDetails } from "../search/scraper.js";
import { downloadAndCacheImage } from "../core/images/downloader.js";
import { enrichItemsWithFileStats, prepareImagesDirectory } from "./scanner.js";
import { fetchTopicTitle, refreshDownloadedItem, scanDownloadedFolder } from "./service.js";
import type { DownloadedItem } from "../core/types.js";
import { getKnownTags } from "../core/known-tags.js";
import { validateFolderPath } from "../core/fs-paths.js";

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
};

const SORT_FIELDS = new Set(["fileName", "fileSizeBytes", "starring", "fileBirthtimeMs"]);

function matchesText(haystack: string | null | undefined, query: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(query);
}

function applyDownloadedFilterSort(
  items: DownloadedItem[],
  query: string | null,
  sortBy: string | null,
  sortDir: string | null,
  tagsFilter: string[] | null,
): DownloadedItem[] {
  let filtered = items;
  if (query) {
    const q = query.toLowerCase();
    filtered = items.filter(
      (item) =>
        matchesText(item.fileName, q) ||
        matchesText(item.title, q) ||
        matchesText(item.starring, q) ||
        (item.tags ?? []).some((t) => t.name.toLowerCase().includes(q)),
    );
  }

  if (tagsFilter && tagsFilter.length > 0) {
    // All filter tags must be present on the item (case-insensitive).
    const required = tagsFilter.map((t) => t.toLowerCase());
    filtered = filtered.filter((item) => {
      const itemTags = (item.tags ?? []).map((t) => t.name.toLowerCase());
      return required.every((t) => itemTags.includes(t));
    });
  }

  const field = sortBy && SORT_FIELDS.has(sortBy) ? sortBy : "fileBirthtimeMs";
  const dir = sortDir === "asc" ? 1 : -1; // default to DESC
  const sorted = [...filtered].sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[field] as string | number | null | undefined;
    const bv = (b as unknown as Record<string, unknown>)[field] as string | number | null | undefined;
    // Push nulls/undefined to the end regardless of direction.
    const aNull = av === null || av === undefined || av === "";
    const bNull = bv === null || bv === undefined || bv === "";
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return (av - bv) * dir;
    }
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * dir;
  });
  return sorted;
}

export const handleDownloadedRoutes: RouteHandler = async ({ req, res, url, method, app }) => {
  const store = app.getDownloadedStore();

  if (url.pathname === "/api/downloaded" && method === "GET") {
    const q = url.searchParams.get("q");
    const sortBy = url.searchParams.get("sortBy");
    const sortDir = url.searchParams.get("sortDir");
    const tagsRaw = url.searchParams.get("tags");
    const tagsFilter = tagsRaw
      ? tagsRaw.split(",").map((t) => t.trim()).filter((t) => t.length > 0)
      : null;
    const items = store.getAll();
    const enriched = enrichItemsWithFileStats(items);
    json(res, applyDownloadedFilterSort(enriched, q, sortBy, sortDir, tagsFilter));
    return true;
  }

  if (url.pathname === "/api/downloaded/tags" && method === "GET") {
    // Merge in tags from the Results/topics store too so both tabs share one
    // tag vocabulary. Falls back to just this store's tags if the app stub
    // doesn't expose a topic store (e.g. in isolated route tests).
    json(res, { tags: getKnownTags(app) });
    return true;
  }

  if (url.pathname === "/api/downloaded/tags" && method === "PATCH") {
    const body = await readJson<{
      id: number;
      // Accept either bare strings (legacy/curated) or {name, color} objects.
      tags: unknown;
    }>(req);
    const { id } = body;
    if (!id) {
      json(res, { error: "id is required" }, 400);
      return true;
    }
    const item = store.getById(id);
    if (!item) {
      json(res, { error: "Item not found" }, 404);
      return true;
    }
    store.updateTags(id, body.tags ?? []);
    const updated = store.getById(id);
    json(res, { tags: updated?.tags ?? [] });
    return true;
  }

  if (url.pathname === "/api/downloaded/folder" && method === "GET") {
    json(res, { folderPath: app.loadConfig().downloadedFolder ?? "" });
    return true;
  }

  if (url.pathname === "/api/downloaded/folder" && method === "PUT") {
    const { folderPath } = await readJson<{ folderPath: string }>(req);
    const validation = validateFolderPath(folderPath);
    if (!validation.ok) {
      json(res, { error: validation.reason }, 400);
      return true;
    }
    const config = app.loadConfig();
    config.downloadedFolder = validation.absolutePath;
    app.saveConfig(config);
    json(res, { folderPath: validation.absolutePath });
    return true;
  }

  // POST /api/downloaded/scan-folder — full scan (purges existing rows)
  if (url.pathname === "/api/downloaded/scan-folder" && method === "POST") {
    const { folderPath } = await readJson<{ folderPath: string }>(req);
    const validation = validateFolderPath(folderPath);
    if (!validation.ok) {
      json(res, { error: validation.reason }, 400);
      return true;
    }
    const emit = startSse(res);
    try {
      await scanDownloadedFolder(app, validation.absolutePath, true, emit);
    } catch (error) {
      emit({ phase: "error", message: (error as Error).message });
    }
    res.end();
    return true;
  }

  // POST /api/downloaded/scan-incremental — scan only new files
  if (url.pathname === "/api/downloaded/scan-incremental" && method === "POST") {
    const { folderPath } = await readJson<{ folderPath: string }>(req);
    const validation = validateFolderPath(folderPath);
    if (!validation.ok) {
      json(res, { error: validation.reason }, 400);
      return true;
    }
    const emit = startSse(res);
    try {
      await scanDownloadedFolder(app, validation.absolutePath, false, emit);
    } catch (error) {
      emit({ phase: "error", message: (error as Error).message });
    }
    res.end();
    return true;
  }

  // DELETE /api/downloaded/item?id=… — delete a single downloaded item (DB row + file)
  if (url.pathname === "/api/downloaded/item" && method === "DELETE") {
    const id = Number.parseInt(url.searchParams.get("id") ?? "", 10);
    if (Number.isNaN(id)) {
      json(res, { error: "id query parameter is required" }, 400);
      return true;
    }
    const item = store.getById(id);
    if (!item) {
      json(res, { error: "Item not found" }, 404);
      return true;
    }
    if (item.filePath && fs.existsSync(item.filePath)) {
      try { fs.unlinkSync(item.filePath); } catch {}
    }
    if (item.cachedImage) {
      const imagePath = path.join(path.dirname(item.filePath), ".images", item.cachedImage);
      if (fs.existsSync(imagePath)) {
        try { fs.unlinkSync(imagePath); } catch {}
      }
    }
    store.deleteById(id);
    json(res, { deleted: true, id });
    return true;
  }

  // PATCH /api/downloaded/topic-url — manually set (or clear) topic URL, fetch details and image
  if (url.pathname === "/api/downloaded/topic-url" && method === "PATCH") {
    const { id, topicUrl: rawTopicUrl } = await readJson<{ id: number; topicUrl: string }>(req);
    const topicUrl = rawTopicUrl?.trim() ? rawTopicUrl.trim() : null;
    if (!id) {
      json(res, { error: "id is required" }, 400);
      return true;
    }
    const item = store.getById(id);
    if (!item) {
      json(res, { error: "Item not found" }, 404);
      return true;
    }

    const emit = startSse(res);
    if (!topicUrl) {
      // Clearing the topic URL wipes all topic-derived details (fileName/filePath untouched).
      const clearedFields = {
        topicUrl: null,
        title: null,
        postImage: null,
        cachedImage: null,
        starring: null,
        productionDate: null,
        duration: null,
        size: null,
      };
      store.updateItem(id, clearedFields);
      emit({ phase: "done", message: "Topic URL and details cleared", data: clearedFields });
      res.end();
      return true;
    }
    try {
      const details = await fetchTopicDetails(topicUrl, app.loadConfig(), emit);
      const imagesDir = prepareImagesDirectory(path.dirname(item.filePath));
      const cachedImage = details.postImage
        ? await downloadAndCacheImage(details.postImage, topicUrl, imagesDir)
        : null;
      const title = await fetchTopicTitle(topicUrl).catch(() => null);
      store.updateTopicInfo(
        id,
        title,
        topicUrl,
        details.postImage,
        cachedImage,
        details.starring,
        details.productionDate,
        details.duration,
        details.size,
      );
      emit({
        phase: "done",
        message: "Topic URL set",
        data: {
          title,
          topicUrl,
          postImage: details.postImage,
          cachedImage,
          starring: details.starring,
          productionDate: details.productionDate,
          duration: details.duration,
          size: details.size,
        },
      });
    } catch (error) {
      emit({ phase: "error", message: (error as Error).message });
    }
    res.end();
    return true;
  }

  // PATCH /api/downloaded/item — update editable fields for a downloaded item
  if (url.pathname === "/api/downloaded/item" && method === "PATCH") {
    const body = await readJson<{
      id: number;
      title?: string | null;
      topicUrl?: string | null;
      postImageUrl?: string | null;
      starring?: string | null;
      productionDate?: string | null;
      duration?: string | null;
      size?: string | null;
    }>(req);
    const { id } = body;
    if (!id) {
      json(res, { error: "id is required" }, 400);
      return true;
    }
    const item = store.getById(id);
    if (!item) {
      json(res, { error: "Item not found" }, 404);
      return true;
    }

    const emit = startSse(res);
    try {
      const fields: Record<string, string | null> = {};
      if ("title" in body) fields.title = body.title?.trim() ? body.title.trim() : null;
      if ("starring" in body) fields.starring = body.starring?.trim() ? body.starring.trim() : null;
      if ("productionDate" in body) fields.productionDate = body.productionDate?.trim() ? body.productionDate.trim() : null;
      if ("duration" in body) fields.duration = body.duration?.trim() ? body.duration.trim() : null;
      if ("size" in body) fields.size = body.size?.trim() ? body.size.trim() : null;

      if ("topicUrl" in body) {
        const newUrl = body.topicUrl?.trim() ? body.topicUrl.trim() : null;
        // Only change topicUrl if it's actually different to avoid pointless re-fetches.
        if (newUrl !== item.topicUrl) {
          fields.topicUrl = newUrl;
          if (newUrl) {
            emit({ phase: "processing", message: `Crawling new topic URL...` });
            const details = await fetchTopicDetails(newUrl, app.loadConfig(), emit);
            // Crawl results override user-provided values for these derived fields,
            // unless the user explicitly set them.
            if (!("starring" in body) && details.starring) fields.starring = details.starring;
            if (!("productionDate" in body) && details.productionDate) fields.productionDate = details.productionDate;
            if (!("duration" in body) && details.duration) fields.duration = details.duration;
            if (!("size" in body) && details.size) fields.size = details.size;
            if (!("title" in body)) {
              const crawledTitle = await fetchTopicTitle(newUrl).catch(() => null);
              if (crawledTitle) fields.title = crawledTitle;
            }
          } else {
            // Clearing the topic URL wipes all topic-derived details, unlike
            // changing it (where a missing crawled field just keeps the old value).
            fields.title = null;
            fields.postImage = null;
            fields.cachedImage = null;
            fields.starring = null;
            fields.productionDate = null;
            fields.duration = null;
            fields.size = null;
          }
        }
      }

      if ("postImageUrl" in body) {
        const rawUrl = body.postImageUrl?.trim() ? body.postImageUrl.trim() : null;
        if (rawUrl) {
          const imagesDir = prepareImagesDirectory(path.dirname(item.filePath));
          emit({ phase: "processing", message: `Resolving post image...` });
          const cached = await downloadAndCacheImage(rawUrl, item.topicUrl ?? rawUrl, imagesDir);
          if (cached) {
            fields.cachedImage = cached;
            fields.postImage = rawUrl;
            emit({ phase: "processing", message: `Post image saved.` });
          } else {
            emit({ phase: "processing", message: `Failed to download post image — keeping existing.` });
          }
        } else {
          fields.cachedImage = null;
          fields.postImage = null;
        }
      }

      store.updateItem(id, fields);
      const updated = store.getById(id);
      emit({ phase: "done", message: "Item updated", item: updated });
    } catch (error) {
      emit({ phase: "error", message: (error as Error).message });
    }
    res.end();
    return true;
  }

  // POST /api/downloaded/refresh-item — reload details/image from pornolab for a single item
  if (url.pathname === "/api/downloaded/refresh-item" && method === "POST") {
    const { id } = await readJson<{ id: number }>(req);
    if (!id) {
      json(res, { error: "id is required" }, 400);
      return true;
    }
    const item = store.getById(id);
    if (!item) {
      json(res, { error: "Item not found" }, 404);
      return true;
    }
    const emit = startSse(res);
    try {
      await refreshDownloadedItem(app, item, emit);
    } catch (error) {
      emit({ phase: "error", message: (error as Error).message });
    }
    res.end();
    return true;
  }

  // GET /api/downloaded/images/:filename — serve a cached post image
  if (url.pathname.startsWith("/api/downloaded/images/") && method === "GET") {
    const filename = decodeURIComponent(url.pathname.slice("/api/downloaded/images/".length));
    if (!filename || filename.includes("..") || filename.includes("/")) {
      json(res, { error: "Invalid filename" }, 400);
      return true;
    }
    // Resolve the filename against any known .images directory. Prefer the
    // currently-configured downloaded folder; fall back to scanning items.
    const candidates: string[] = [];
    const cfgFolder = app.loadConfig().downloadedFolder;
    const cfgValidation = validateFolderPath(cfgFolder);
    if (cfgValidation.ok) candidates.push(path.join(cfgValidation.absolutePath, ".images", filename));
    for (const item of store.getAll()) {
      if (item.cachedImage === filename) {
        candidates.push(path.join(path.dirname(item.filePath), ".images", filename));
      }
    }
    const filePath = candidates.find((p) => fs.existsSync(p));
    if (!filePath) {
      json(res, { error: "Image not found" }, 404);
      return true;
    }
    res.writeHead(200, {
      "Content-Type": IMAGE_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "max-age=86400",
    });
    res.end(fs.readFileSync(filePath));
    return true;
  }

  return false;
};
