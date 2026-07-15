import type { AppContext } from "../core/server/context.js";
import { crawl } from "./scraper.js";

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
