import type { RouteHandler } from "../core/server/router.js";
import { json, readJson, startSse } from "../core/server/http.js";
import { fetchForumOptions, fetchTopicDetails, searchPornolab } from "./scraper.js";
import { analyzeBatch, type BatchAnalyzeItem } from "../ai/batch-analyzer.js";

export const handleSearchRoutes: RouteHandler = async ({ req, res, url, method, app }) => {
  // POST /api/search/analyze-batch — bulk-analyze the current search result
  // page. Search results aren't in the local topics DB (they're live
  // tracker results, possibly never added), so nothing is persisted here —
  // the score is returned for the client to show transiently on each card,
  // same "computed, shown, not stored" idea as the Results tab's debug
  // tooltip (see docs/ai.spec.md §7/§10).
  if (url.pathname === "/api/search/analyze-batch" && method === "POST") {
    const { items } = await readJson<{ items: { topicUrl: string; title: string; starring?: string | null }[] }>(req);
    const config = app.loadConfig();
    if (!config.ai.enabled) {
      json(res, { error: "AI rating is not enabled" }, 400);
      return true;
    }
    if (!Array.isArray(items) || items.length === 0) {
      json(res, { error: "items is required" }, 400);
      return true;
    }

    const emit = startSse(res);
    const batchItems: BatchAnalyzeItem[] = items
      .filter((item) => item.topicUrl && item.title)
      .map((item) => ({ key: item.topicUrl, title: item.title, topicUrl: item.topicUrl, starring: item.starring ?? null }));

    const actresses = app.getActressStore().getAll();
    await analyzeBatch(batchItems, config, actresses, emit);
    emit({ phase: "done", message: `Analyzed ${batchItems.length}/${items.length} item(s)`, analyzed: batchItems.length, total: items.length });
    res.end();
    return true;
  }

  if (url.pathname === "/api/search" && method === "POST") {
    const { query, forums, start } = await readJson<{ query: string; forums?: number[]; start?: number }>(req);
    if (!query) {
      json(res, { error: "query is required" }, 400);
      return true;
    }
    const emit = startSse(res);
    try {
      const result = await searchPornolab(app.loadConfig(), { query, forums, start }, emit);
      emit({ phase: "results", data: result.results, pagination: result.pagination });
    } catch (error) {
      emit({ phase: "error", message: (error as Error).message });
    }
    res.end();
    return true;
  }

  if (url.pathname === "/api/topic/details" && method === "GET") {
    const topicUrl = url.searchParams.get("url");
    if (!topicUrl) {
      json(res, { error: "url is required" }, 400);
      return true;
    }
    const emit = startSse(res);
    try {
      emit({ phase: "results", data: await fetchTopicDetails(topicUrl, app.loadConfig(), emit) });
    } catch (error) {
      emit({ phase: "error", message: (error as Error).message });
    }
    res.end();
    return true;
  }

  if (url.pathname === "/api/search/forums" && method === "GET") {
    const emit = startSse(res);
    try {
      emit({ phase: "results", data: await fetchForumOptions(app.loadConfig(), emit) });
    } catch (error) {
      emit({ phase: "error", message: (error as Error).message });
    }
    res.end();
    return true;
  }

  return false;
};
