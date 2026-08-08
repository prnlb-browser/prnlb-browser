import type { AppContext } from "../core/server/context.js";
import type { Config, TopicData } from "../core/types.js";
import { crawl } from "./scraper.js";
import { analyzeBatch, type BatchAnalyzeItem } from "../ai/batch-analyzer.js";

// Auto-hide (docs/ai.spec.md — Crawl tab "Auto hide items with rate <"):
// analyzes every topic freshly inserted by this crawl and hides any whose
// aiRating comes back below the configured threshold. Reuses the same
// analyzeBatch()/computeScore() pipeline the Results/Downloaded/Search bulk
// "Analyze" actions already use (src/ai/batch-analyzer.ts) — this is just
// another caller of it, plus the hide step.
async function autoHideLowRated(app: AppContext, config: Config, items: TopicData[]): Promise<void> {
  const store = app.getTopicStore();
  const actresses = app.getActressStore().getAll();
  const threshold = config.ai.autoHide.belowRating;
  const titleByUrl = new Map(items.map((item) => [item.topicUrl, item.title]));
  const batchItems: BatchAnalyzeItem[] = items.map((item) => ({
    key: item.topicUrl,
    title: item.title,
    topicUrl: item.topicUrl,
    starring: item.starring,
  }));

  let hiddenCount = 0;
  await analyzeBatch(batchItems, config, actresses, (event) => {
    if (event.phase === "start") {
      app.emitCrawlProgress({ phase: "analyzing", message: `Auto-hide: ${event.message}`, total: event.total });
      return;
    }
    if (event.phase === "item") {
      app.emitCrawlProgress({ phase: "analyzing", message: event.message, current: event.current, total: event.total });
      return;
    }
    if (event.phase === "item-error") {
      app.emitCrawlProgress({
        phase: "analyzing",
        message: `Skipped (analysis failed): ${titleByUrl.get(event.key) ?? event.key} — ${event.message}`,
        current: event.current,
        total: event.total,
      });
      return;
    }
    store.setAiRating(event.key, event.aiRating);
    const ratingText = event.aiRating != null ? `${Math.round(event.aiRating)}%` : "n/a";
    if (event.aiRating != null && event.aiRating < threshold) {
      store.setHidden(event.key, true);
      hiddenCount++;
      app.emitCrawlProgress({
        phase: "analyzing",
        message: `🙈 Hidden (${ratingText} < ${threshold}%): ${titleByUrl.get(event.key) ?? event.key}`,
        current: event.current,
        total: event.total,
      });
    } else {
      app.emitCrawlProgress({
        phase: "analyzing",
        message: `Rated ${ratingText}: ${titleByUrl.get(event.key) ?? event.key}`,
        current: event.current,
        total: event.total,
      });
    }
  }, app.userDataDir);
  app.emitCrawlProgress({
    phase: "analyzing",
    message: `Auto-hide: ${hiddenCount} item(s) hidden (rating below ${threshold}%)`,
  });
}

export async function runCrawl(app: AppContext): Promise<void> {
  const config = app.loadConfig();
  const store = app.getTopicStore();
  const existingUrls = new Set(store.getAll().map((topic) => topic.topicUrl));

  try {
    const { results, skipped: preFiltered } = await crawl(
      config,
      (progress) => app.emitCrawlProgress(progress),
      existingUrls,
    );
    const { inserted, skipped: dbSkipped } = store.insertMany(results);
    app.crawl.lastResults = results;
    const totalSkipped = preFiltered + dbSkipped;

    if (config.ai.enabled && config.ai.autoHide.enabled && results.length > 0) {
      await autoHideLowRated(app, config, results);
    }

    app.emitCrawlProgress({
      phase: "done",
      message: `Done — ${inserted} new, ${totalSkipped} skipped (already in DB), ${results.length + totalSkipped} total processed`,
    });
  } catch (error) {
    app.emitCrawlProgress({ phase: "error", message: (error as Error).message });
  } finally {
    app.crawl.isRunning = false;
  }
}
