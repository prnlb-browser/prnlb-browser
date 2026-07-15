import type { RouteHandler } from "../core/server/router.js";
import { json, readJson, startSse } from "../core/server/http.js";
import { submitCaptchaCode } from "../core/captcha-handler.js";
import { runCrawl } from "./service.js";

export const handleCrawlRoutes: RouteHandler = async ({ req, res, url, method, app }) => {
  if (url.pathname === "/api/crawl" && method === "POST") {
    if (app.crawl.isRunning) {
      json(res, { error: "Crawl is already running" }, 409);
      return true;
    }

    app.crawl.isRunning = true;
    app.crawl.lastProgress = null;
    app.crawl.lastResults = null;
    json(res, { message: "Crawl started" });
    await runCrawl(app);
    return true;
  }

  if (url.pathname === "/api/status" && method === "GET") {
    json(res, {
      running: app.crawl.isRunning,
      progress: app.crawl.lastProgress,
      hasResults: app.crawl.lastResults !== null,
      lastCrawlCount: app.crawl.lastResults?.length ?? 0,
      dbTotal: app.getTopicStore().count(),
    });
    return true;
  }

  if (url.pathname === "/api/events" && method === "GET") {
    const emit = startSse(res);
    if (app.crawl.lastProgress) emit(app.crawl.lastProgress);
    if (!app.crawl.isRunning) emit({ phase: "idle", message: "Ready" });

    const listener = (progress: Parameters<typeof app.emitCrawlProgress>[0]) => emit(progress);
    app.crawl.listeners.add(listener);
    req.on("close", () => app.crawl.listeners.delete(listener));
    return true;
  }

  if (url.pathname === "/api/captcha" && method === "POST") {
    const { captchaId, code } = await readJson<{ captchaId: string; code: string }>(req);
    if (!captchaId || !code) {
      json(res, { error: "captchaId and code are required" }, 400);
      return true;
    }
    json(res, { success: submitCaptchaCode(captchaId, code) });
    return true;
  }

  return false;
};
