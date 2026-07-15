import type { TopicData } from "../core/types.js";
import type { RouteHandler } from "../core/server/router.js";
import { json, readJson, startSse } from "../core/server/http.js";
import { fetchTopicDetails } from "../search/scraper.js";
import { getKnownTags } from "../core/known-tags.js";

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[,"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// All filter tags must be present on the topic (case-insensitive), mirroring
// the Downloaded tab's tag filter semantics.
function applyTagsFilter(topics: TopicData[], tagsFilter: string[] | null): TopicData[] {
  if (!tagsFilter || tagsFilter.length === 0) return topics;
  const required = tagsFilter.map((t) => t.toLowerCase());
  return topics.filter((topic) => {
    const topicTags = (topic.tags ?? []).map((t) => t.name.toLowerCase());
    return required.every((t) => topicTags.includes(t));
  });
}

export const handleResultsRoutes: RouteHandler = async ({ req, res, url, method, app }) => {
  const store = app.getTopicStore();

  if (url.pathname === "/api/forums" && method === "GET") {
    json(res, store.getDistinctForums());
    return true;
  }

  if (url.pathname === "/api/results" && method === "GET") {
    const query = url.searchParams.get("q");
    const forum = url.searchParams.get("forum");
    const tagsRaw = url.searchParams.get("tags");
    const tagsFilter = tagsRaw
      ? tagsRaw.split(",").map((t) => t.trim()).filter((t) => t.length > 0)
      : null;
    const results = query && forum
      ? store.searchByForum(query, forum)
      : forum
        ? store.getByForum(forum)
        : query
          ? store.search(query)
          : store.getAll();
    json(res, applyTagsFilter(results, tagsFilter));
    return true;
  }

  if (url.pathname === "/api/results/tags" && method === "GET") {
    // Merged with the Downloaded store's tags so both tabs share one tag
    // vocabulary — see src/core/known-tags.ts.
    json(res, { tags: getKnownTags(app) });
    return true;
  }

  if (url.pathname === "/api/results/tags" && method === "PATCH") {
    const body = await readJson<{ topicUrl: string; tags: unknown }>(req);
    const { topicUrl } = body;
    if (!topicUrl) {
      json(res, { error: "topicUrl is required" }, 400);
      return true;
    }
    const topic = store.getByUrl(topicUrl);
    if (!topic) {
      json(res, { error: "Topic not found" }, 404);
      return true;
    }
    store.updateTags(topicUrl, body.tags ?? []);
    const updated = store.getByUrl(topicUrl);
    json(res, { tags: updated?.tags ?? [] });
    return true;
  }

  if (url.pathname === "/api/results/item" && method === "PATCH") {
    const body = await readJson<{
      topicUrl: string;
      title?: string | null;
      postImage?: string | null;
      starring?: string | null;
      productionDate?: string | null;
      duration?: string | null;
      size?: string | null;
    }>(req);
    const { topicUrl } = body;
    if (!topicUrl) {
      json(res, { error: "topicUrl is required" }, 400);
      return true;
    }
    const topic = store.getByUrl(topicUrl);
    if (!topic) {
      json(res, { error: "Topic not found" }, 404);
      return true;
    }

    const fields: Partial<Pick<TopicData, "title" | "postImage" | "starring" | "productionDate" | "duration" | "size">> = {};
    // title is NOT NULL in the schema — an empty value keeps the existing title.
    if ("title" in body) fields.title = body.title?.trim() ? body.title.trim() : topic.title;
    if ("postImage" in body) fields.postImage = body.postImage?.trim() ? body.postImage.trim() : null;
    if ("starring" in body) fields.starring = body.starring?.trim() ? body.starring.trim() : null;
    if ("productionDate" in body) fields.productionDate = body.productionDate?.trim() ? body.productionDate.trim() : null;
    if ("duration" in body) fields.duration = body.duration?.trim() ? body.duration.trim() : null;
    if ("size" in body) fields.size = body.size?.trim() ? body.size.trim() : null;

    store.updateItem(topicUrl, fields);
    const updated = store.getByUrl(topicUrl);
    json(res, { item: updated });
    return true;
  }

  if (url.pathname === "/api/results/item/hide" && method === "PATCH") {
    const { topicUrl } = await readJson<{ topicUrl: string }>(req);
    if (!topicUrl) {
      json(res, { error: "topicUrl is required" }, 400);
      return true;
    }
    json(res, { topicUrl, hidden: store.toggleHidden(topicUrl) });
    return true;
  }

  if (url.pathname === "/api/results" && method === "DELETE") {
    json(res, { message: `Deleted ${store.clearAll()} topics` });
    return true;
  }

  if (url.pathname === "/api/results/item" && method === "DELETE") {
    const topicUrl = url.searchParams.get("url");
    if (!topicUrl) {
      json(res, { error: "url query parameter is required" }, 400);
      return true;
    }
    json(res, { deleted: store.deleteByUrl(topicUrl), topicUrl });
    return true;
  }

  if (url.pathname === "/api/results/refresh-details" && method === "POST") {
    const { topicUrl } = await readJson<{ topicUrl: string }>(req);
    if (!topicUrl) {
      json(res, { error: "topicUrl is required" }, 400);
      return true;
    }
    const emit = startSse(res);
    try {
      const details = await fetchTopicDetails(topicUrl, app.loadConfig(), emit);
      store.updateDetails(topicUrl, details);
      emit({ phase: "done", message: "Details updated", data: details });
    } catch (error) {
      emit({ phase: "error", message: (error as Error).message });
    }
    res.end();
    return true;
  }

  if (url.pathname === "/api/results/export" && method === "GET") {
    const headers = ["topicUrl", "title", "postImage", "starring", "productionDate", "duration", "size", "torrentUrl", "sourceForum", "hidden"];
    const lines = [headers.join(",")];
    for (const topic of store.getAll()) {
      const record = topic as unknown as Record<string, unknown>;
      lines.push(headers.map((header) => escapeCsv(record[header])).join(","));
    }
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="topics-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
    res.end(lines.join("\n"));
    return true;
  }

  if (url.pathname === "/api/results" && method === "POST") {
    const topic = await readJson<TopicData>(req);
    if (!topic.topicUrl) {
      json(res, { error: "topicUrl is required" }, 400);
      return true;
    }
    json(res, { inserted: store.insert(topic), topicUrl: topic.topicUrl });
    return true;
  }

  return false;
};
