import type { AiScoreRule } from "../core/types.js";
import type { ScreenshotAnalysis, TitleAnalysis } from "./types.js";
import { EMPTY_ACTRESS_CONTEXT, type ActressMatchContext } from "../core/actress-match.js";

// See docs/ai.spec.md §8.3. Baseline 50 (neutral) when no rules match; a
// single weight:1.0 rule matching alone saturates to 100, weight:-1.0 alone
// saturates to 0. Multiple matches sum before the clamp. First-pass formula,
// not validated against real rule sets yet.
//
// `actress` defaults to "no matches" so existing callers (and tests) that
// don't care about actress rules don't need to thread one through.
export function computeScore(
  rules: AiScoreRule[],
  title: TitleAnalysis,
  screenshots: ScreenshotAnalysis,
  actress: ActressMatchContext = EMPTY_ACTRESS_CONTEXT,
): number | null {
  if (rules.length === 0) return null;

  const tagPool = [...title.tags, ...screenshots.tags].map((tag) => tag.toLowerCase());
  const characteristicPool = screenshots.performers.flatMap((performer) => Object.values(performer));

  let sum = 0;
  for (const rule of rules) {
    if (ruleMatches(rule, tagPool, characteristicPool, actress)) sum += rule.weight;
  }

  return Math.max(0, Math.min(100, Math.round(50 + sum * 50)));
}

function ruleMatches(
  rule: AiScoreRule,
  tagPool: string[],
  characteristicPool: unknown[],
  actress: ActressMatchContext,
): boolean {
  if (rule.type === "tag") return tagPool.some((tag) => tag.includes(rule.value.toLowerCase()));
  // "predefined-tag" is an exact match against the fixed SceneCompositionTag
  // vocabulary, unlike "tag"'s substring match — the value only ever comes
  // from a dropdown, so a partial match would be surprising (e.g. "MF"
  // shouldn't match a "MMF" tag).
  if (rule.type === "predefined-tag") return tagPool.includes(rule.value.toLowerCase());
  if (rule.type === "performer-characteristic") return characteristicPool.includes(rule.value);
  // "actress"
  if (rule.value === "favorite") return actress.matchedFavoriteNames.length > 0;
  if (rule.value === "saved") return actress.matchedNames.length > 0;
  return actress.matchedNames.some((name) => name.toLowerCase() === rule.value.toLowerCase());
}
