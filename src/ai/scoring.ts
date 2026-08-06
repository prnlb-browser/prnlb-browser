import type { AiScoreRule } from "../core/types.js";
import type { ScreenshotAnalysis, TitleAnalysis } from "./types.js";

// See docs/ai.spec.md §8.3. Baseline 50 (neutral) when no rules match; a
// single weight:1.0 rule matching alone saturates to 100, weight:-1.0 alone
// saturates to 0. Multiple matches sum before the clamp. First-pass formula,
// not validated against real rule sets yet.
export function computeScore(rules: AiScoreRule[], title: TitleAnalysis, screenshots: ScreenshotAnalysis): number | null {
  if (rules.length === 0) return null;

  const tagPool = [...title.tags, ...screenshots.tags].map((tag) => tag.toLowerCase());
  const characteristicPool = screenshots.performers.flatMap((performer) => Object.values(performer));

  let sum = 0;
  for (const rule of rules) {
    const matched =
      rule.type === "tag"
        ? tagPool.some((tag) => tag.includes(rule.value.toLowerCase()))
        : characteristicPool.includes(rule.value);
    if (matched) sum += rule.weight;
  }

  return Math.max(0, Math.min(100, Math.round(50 + sum * 50)));
}
