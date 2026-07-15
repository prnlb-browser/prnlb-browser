import type { RouteHandler } from "../server/router.js";
import { json, readJson, startSse } from "../server/http.js";
import { resolverRegistry } from "./registry.js";
import { scrapeTopicImages } from "./topic-scraper.js";

export const handleImageRoutes: RouteHandler = async ({ req, res, url, method }) => {
  if (url.pathname !== "/api/topic/images" || method !== "POST") return false;

  const { topicUrl } = await readJson<{ topicUrl: string }>(req);
  if (!topicUrl) {
    json(res, { error: "topicUrl is required" }, 400);
    return true;
  }

  const emit = startSse(res);
  try {
    const scraped = await scrapeTopicImages(topicUrl, emit);
    const handled = scraped.filter((image) => resolverRegistry.findResolver(image.resolveUrl));
    const images = await resolverRegistry.resolveImages(handled, emit);
    emit({ phase: "done", images, total: scraped.length, resolved: images.length });
  } catch (error) {
    emit({ phase: "error", message: (error as Error).message });
  }
  res.end();
  return true;
};
