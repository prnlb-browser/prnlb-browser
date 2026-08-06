import type { AiScoreRule, PerformerCharacteristicValue } from "../core/types.js";
import type { ScreenshotAnalysis, TitleAnalysis } from "./types.js";

export interface AnalyzedItem {
  title: TitleAnalysis;
  screenshots: ScreenshotAnalysis;
}

// Deterministic, non-AI rule generation: counts how many of the analyzed
// items exhibit each tag / performer characteristic and turns the most
// frequent ones into positively-weighted rules. This assumes the sampled
// items are things the user chose to download (and presumably liked), so
// weights only ever come out non-negative — this generator has no way to
// infer what the user *dislikes* from a download sample alone.
export function suggestRulesFromAnalyses(items: AnalyzedItem[], ruleCount: number): AiScoreRule[] {
  if (items.length === 0 || ruleCount <= 0) return [];

  const tagCounts = new Map<string, number>();
  const tagDisplay = new Map<string, string>(); // lowercase key -> first-seen original casing
  const characteristicCounts = new Map<PerformerCharacteristicValue, number>();

  for (const { title, screenshots } of items) {
    // Count each tag/characteristic at most once per item, so one item
    // repeating a value doesn't skew frequency across the sample. Dedupe by
    // lowercase key (not the raw string) so case variants of the same tag
    // within one item — e.g. "Anal" and "anal" — collapse to one occurrence.
    const tagsInItem = new Map<string, string>(); // lowercase key -> first-seen original casing
    for (const raw of [...title.tags, ...screenshots.tags]) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!tagsInItem.has(key)) tagsInItem.set(key, trimmed);
    }
    for (const [key, tag] of tagsInItem) {
      tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
      if (!tagDisplay.has(key)) tagDisplay.set(key, tag);
    }

    const characteristicsInItem = new Set(
      screenshots.performers.flatMap((performer) => Object.values(performer)).filter((value) => value !== "unknown"),
    ) as Set<PerformerCharacteristicValue>;
    for (const value of characteristicsInItem) {
      characteristicCounts.set(value, (characteristicCounts.get(value) ?? 0) + 1);
    }
  }

  const candidates: { rule: AiScoreRule; count: number }[] = [];
  for (const [key, count] of tagCounts) {
    candidates.push({ rule: { type: "tag", value: tagDisplay.get(key) ?? key, weight: weightFor(count, items.length) }, count });
  }
  for (const [value, count] of characteristicCounts) {
    candidates.push({ rule: { type: "performer-characteristic", value, weight: weightFor(count, items.length) }, count });
  }

  // Most-frequent first; Map iteration order (insertion/first-seen) breaks ties.
  candidates.sort((a, b) => b.count - a.count);
  return candidates.slice(0, ruleCount).map((c) => c.rule);
}

// Fraction of the sample exhibiting the value, rounded to the same 0.1
// step the rule-editor UI uses, floored at 0.1 so a rule that made the cut
// never ends up with a rounded-to-zero (i.e. no-op) weight.
function weightFor(count: number, total: number): number {
  const ratio = total > 0 ? count / total : 0;
  return Math.max(0.1, Math.round(ratio * 10) / 10);
}

// Fisher-Yates shuffle-and-slice — used to pick a random sample of
// downloaded items to analyze. Does not mutate the input array.
export function pickRandomSample<T>(items: T[], count: number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j] as T, pool[i] as T];
  }
  return pool.slice(0, Math.max(0, Math.min(count, pool.length)));
}
