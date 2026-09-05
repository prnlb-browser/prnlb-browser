import type { RouteHandler } from "../core/server/router.js";
import { json, readJson, startSse } from "../core/server/http.js";
import { fetchForumOptions, fetchTopicDetails, searchPornolab } from "./scraper.js";

export const handleSearchRoutes: RouteHandler = async ({ req, res, url, method, app }) => {
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
