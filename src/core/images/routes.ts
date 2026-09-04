import * as path from "node:path";
import type { RouteHandler } from "../server/router.js";
import { json, readJson, startSse } from "../server/http.js";
import { resolverRegistry } from "./registry.js";
import { scrapeTopicImages } from "./topic-scraper.js";
import { fetchImageBytes } from "./fetch-bytes.js";
import { readCachedScreenshot, resolveScreenshotCacheDir, writeCachedScreenshot } from "./screenshot-cache.js";

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

// Cache key suffix for full-resolution bytes, distinct from the AI screenshot
// analyzer's `::<maxDimension>` resized-variant keys (src/ai/screenshot-analyzer.ts)
// so the two features never serve each other's (differently-sized) version.
const ORIGINAL_VARIANT_SUFFIX = "::original";

export const handleImageRoutes: RouteHandler = async ({ req, res, url, method, app }) => {
  if (url.pathname === "/api/topic/images" && method === "POST") {
    const { topicUrl } = await readJson<{ topicUrl: string }>(req);
    if (!topicUrl) {
      json(res, { error: "topicUrl is required" }, 400);
      return true;
    }

    const emit = startSse(res);
    const controller = new AbortController();
    const onResponseClose = () => {
      // A closed carousel means the renderer no longer needs the result. Do
      // not abort after the route has completed normally.
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", onResponseClose);

    try {
      const scraped = await scrapeTopicImages(topicUrl, emit, controller.signal);
      const handled = scraped.filter((image) => resolverRegistry.findResolver(image.resolveUrl));
      const images = await resolverRegistry.resolveImages(handled, emit, controller.signal);
      if (!controller.signal.aborted) {
        emit({ phase: "done", images, total: scraped.length, resolved: images.length });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        emit({ phase: "error", message: (error as Error).message });
      }
    } finally {
      res.removeListener("close", onResponseClose);
      if (!res.writableEnded) res.end();
    }
    return true;
  }

  // GET /api/topic/image?url=<resolved image URL> — proxies the preview
  // carousel's full-resolution image requests through the same on-disk
  // cache the AI screenshot analyzer uses (Config.screenshotCache, see
  // src/core/images/screenshot-cache.ts), so viewing a topic's screenshots
  // and AI-analyzing it don't each fetch the images separately. `url` is
  // restricted to hosts a resolver recognizes (fastpic/imgbox/turboimagehost) rather than
  // proxying arbitrary URLs, since this endpoint is otherwise a same-origin
  // fetch-any-URL primitive.
  if (url.pathname === "/api/topic/image" && method === "GET") {
    const imageUrl = url.searchParams.get("url");
    if (!imageUrl || !resolverRegistry.findResolver(imageUrl)) {
      json(res, { error: "Invalid or unsupported image URL" }, 400);
      return true;
    }

    const maxSizeMB = app.loadConfig().screenshotCache.maxSizeMB;
    const cacheDir = maxSizeMB > 0 ? resolveScreenshotCacheDir(app.userDataDir) : null;
    const cacheKey = `${imageUrl}${ORIGINAL_VARIANT_SUFFIX}`;

    let bytes = cacheDir ? readCachedScreenshot(cacheDir, cacheKey) : null;
    if (!bytes) {
      bytes = await fetchImageBytes(imageUrl);
      if (!bytes) {
        json(res, { error: "Failed to fetch image" }, 502);
        return true;
      }
      if (cacheDir) writeCachedScreenshot(cacheDir, cacheKey, bytes, maxSizeMB);
    }

    const ext = path.extname(new URL(imageUrl).pathname).toLowerCase();
    res.writeHead(200, {
      "Content-Type": IMAGE_MIME_TYPES[ext] ?? "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    });
    res.end(bytes);
    return true;
  }

  return false;
};
