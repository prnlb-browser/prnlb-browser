import type { Actress, Config } from "../core/types.js";
import { getTextClient, getVisionClient } from "./providers/index.js";
import { analyzeTitle } from "./title-analyzer.js";
import { analyzeScreenshots } from "./screenshot-analyzer.js";
import { computeScore } from "./scoring.js";
import { matchActresses } from "../core/actress-match.js";

export interface BatchAnalyzeItem {
  /** Caller-defined identity used to report progress and apply the result — a topicUrl, a DB id, whatever the caller keys its own items by. */
  key: string;
  title: string;
  topicUrl: string;
  /** Cast text, for "actress" scoring rules (src/core/actress-match.ts). Null if unknown. */
  starring: string | null;
}

export type BatchAnalyzeProgress =
  | { phase: "start"; total: number; message: string }
  | { phase: "item"; current: number; total: number; key: string; message: string }
  | { phase: "item-done"; current: number; total: number; key: string; aiRating: number | null }
  | { phase: "item-error"; current: number; total: number; key: string; message: string };

// Shared "analyze N items, report progress, produce a score per item" loop
// used by the three bulk-analyze routes (Results, Downloaded, Search).
// Deliberately returns only the score, not the raw TitleAnalysis/
// ScreenshotAnalysis — the single-item analyze route and the "Calculate by
// Downloads" rule suggester both need the raw analysis for their own
// purposes (a debug tooltip; frequency counting) and call the analyzers
// directly rather than through this helper, so this isn't a universal
// "the one function everything routes through."
export async function analyzeBatch(
  items: BatchAnalyzeItem[],
  config: Config,
  actresses: Actress[],
  onProgress: (event: BatchAnalyzeProgress) => void,
): Promise<void> {
  onProgress({ phase: "start", total: items.length, message: `Analyzing ${items.length} item(s)...` });
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    onProgress({ phase: "item", current: i + 1, total: items.length, key: item.key, message: `Analyzing "${item.title}"...` });
    try {
      const [titleAnalysis, screenshotAnalysis] = await Promise.all([
        analyzeTitle(item.title, getTextClient(config)),
        analyzeScreenshots(item.topicUrl, getVisionClient(config)),
      ]);
      const actressContext = matchActresses(item.title, item.starring, actresses);
      const aiRating = computeScore(config.ai.scoring.rules, titleAnalysis, screenshotAnalysis, actressContext);
      onProgress({ phase: "item-done", current: i + 1, total: items.length, key: item.key, aiRating });
    } catch (error) {
      onProgress({
        phase: "item-error",
        current: i + 1,
        total: items.length,
        key: item.key,
        message: (error as Error).message,
      });
    }
  }
}
