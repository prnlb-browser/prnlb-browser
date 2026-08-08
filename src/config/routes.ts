import type { Config } from "../core/types.js";
import type { RouteHandler } from "../core/server/router.js";
import { json, readJson, startSse } from "../core/server/http.js";
import { getTextClient, getVisionClient } from "../ai/providers/index.js";
import { analyzeTitle } from "../ai/title-analyzer.js";
import { analyzeScreenshots } from "../ai/screenshot-analyzer.js";
import { pickRandomSample, suggestRulesFromAnalyses, type AnalyzedItem } from "../ai/rule-suggester.js";

export const handleConfigRoutes: RouteHandler = async ({ req, res, url, method, app }) => {
  if (url.pathname === "/api/config" && method === "GET") {
    json(res, app.loadConfig());
    return true;
  }

  if (url.pathname === "/api/config" && method === "PUT") {
    app.saveConfig(await readJson<Config>(req));
    json(res, { message: "Config saved" });
    return true;
  }

  // POST /api/config/ai/suggest-rules — "Calculate by Downloads": samples
  // `count` random downloaded items with a matched topic, runs the title +
  // screenshot analyzers on each, and turns tag/characteristic frequency
  // across the sample into `ruleCount` suggested scoring rules. No AI is
  // involved in the frequency step itself — see src/ai/rule-suggester.ts.
  if (url.pathname === "/api/config/ai/suggest-rules" && method === "POST") {
    const { count, ruleCount } = await readJson<{ count: number; ruleCount: number }>(req);
    const config = app.loadConfig();
    if (!config.ai.enabled) {
      json(res, { error: "AI rating is not enabled" }, 400);
      return true;
    }

    const eligible = app.getDownloadedStore().getAll().filter((item) => !!item.topicUrl);
    if (eligible.length === 0) {
      json(res, { error: "No downloaded items with a matched topic URL to analyze" }, 400);
      return true;
    }

    const sampleSize = Math.max(1, Math.min(Math.floor(count) || 1, eligible.length));
    const sample = pickRandomSample(eligible, sampleSize);

    const emit = startSse(res);
    emit({ phase: "start", total: sample.length, message: `Analyzing ${sample.length} downloaded item(s)...` });

    const analyses: AnalyzedItem[] = [];
    for (let i = 0; i < sample.length; i++) {
      const item = sample[i]!;
      const label = item.title ?? item.fileName;
      emit({ phase: "item", current: i + 1, total: sample.length, message: `Analyzing "${label}"...` });
      try {
        const [titleAnalysis, screenshotAnalysis] = await Promise.all([
          analyzeTitle(label, getTextClient(config)),
          analyzeScreenshots(item.topicUrl!, getVisionClient(config), undefined, config.ai.screenshots, {
            userDataDir: app.userDataDir,
            maxSizeMB: config.screenshotCache.maxSizeMB,
          }),
        ]);
        analyses.push({ title: titleAnalysis, screenshots: screenshotAnalysis });
      } catch (error) {
        emit({
          phase: "item-error",
          current: i + 1,
          total: sample.length,
          message: `Skipped "${label}": ${(error as Error).message}`,
        });
      }
    }

    const rules = suggestRulesFromAnalyses(analyses, Math.max(1, Math.floor(ruleCount) || 1));
    emit({
      phase: "done",
      message: `Analyzed ${analyses.length}/${sample.length} item(s), generated ${rules.length} rule(s)`,
      analyzed: analyses.length,
      total: sample.length,
      rules,
    });
    res.end();
    return true;
  }

  if (url.pathname === "/api/config/ai/clean-rates" && method === "DELETE") {
    const topicsCleared = app.getTopicStore().clearAllAiRatings();
    const downloadedCleared = app.getDownloadedStore().clearAllAiRatings();
    json(res, { message: `Cleared AI rating from ${topicsCleared + downloadedCleared} item(s)` });
    return true;
  }

  return false;
};
