import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickRandomSample, suggestRulesFromAnalyses } from "../src/ai/rule-suggester.js";
import type { ScreenshotAnalysis, TitleAnalysis } from "../src/ai/types.js";

function title(tags: string[] = []): TitleAnalysis {
  return { actresses: [], tags, quality: "unknown" };
}

function screenshots(
  tags: string[] = [],
  performers: ScreenshotAnalysis["performers"] = [],
): ScreenshotAnalysis {
  return { tags, performers };
}

describe("suggestRulesFromAnalyses", () => {
  it("returns [] for no items or a non-positive ruleCount", () => {
    assert.deepEqual(suggestRulesFromAnalyses([], 5), []);
    assert.deepEqual(suggestRulesFromAnalyses([{ title: title(), screenshots: screenshots() }], 0), []);
  });

  it("ranks tags by how many items exhibit them, weight = fraction of the sample", () => {
    const items = [
      { title: title(["Anal", "POV"]), screenshots: screenshots() },
      { title: title(["Anal"]), screenshots: screenshots() },
      { title: title(["Anal"]), screenshots: screenshots() },
      { title: title(["POV"]), screenshots: screenshots() },
    ];
    const rules = suggestRulesFromAnalyses(items, 2);
    assert.deepEqual(rules, [
      { type: "tag", value: "Anal", weight: 0.8 }, // 3/4
      { type: "tag", value: "POV", weight: 0.5 }, // 2/4
    ]);
  });

  it("counts a repeated tag within one item only once", () => {
    const items = [
      { title: title(["Anal", "anal", "ANAL"]), screenshots: screenshots() },
      { title: title([]), screenshots: screenshots() },
    ];
    const rules = suggestRulesFromAnalyses(items, 5);
    assert.deepEqual(rules, [{ type: "tag", value: "Anal", weight: 0.5 }]);
  });

  it("pulls performer characteristics from screenshot analyses, skipping 'unknown'", () => {
    const items = [
      {
        title: title(),
        screenshots: screenshots([], [
          { hairColor: "blonde", hairLength: "long", bodyType: "slim", age: "unknown", race: "unknown", breastSize: "medium" },
        ]),
      },
      {
        title: title(),
        screenshots: screenshots([], [
          { hairColor: "blonde", hairLength: "unknown", bodyType: "athletic", age: "unknown", race: "unknown", breastSize: "unknown" },
        ]),
      },
    ];
    const rules = suggestRulesFromAnalyses(items, 10);
    const byValue = Object.fromEntries(rules.map((r) => [r.value, r]));
    assert.equal(byValue.blonde.type, "performer-characteristic");
    assert.equal(byValue.blonde.weight, 1); // 2/2
    assert.equal(byValue.slim.weight, 0.5);
    assert.equal(byValue.athletic.weight, 0.5);
    assert.ok(!("unknown" in byValue));
  });

  it("combines tags and characteristics into one ranked list, capped at ruleCount", () => {
    const items = [
      {
        title: title(["Anal"]),
        screenshots: screenshots([], [{ hairColor: "blonde", hairLength: "unknown", bodyType: "unknown", age: "unknown", race: "unknown", breastSize: "unknown" }]),
      },
      { title: title(["Anal"]), screenshots: screenshots() },
      { title: title(["POV"]), screenshots: screenshots() },
    ];
    const rules = suggestRulesFromAnalyses(items, 2);
    assert.equal(rules.length, 2);
    assert.equal(rules[0]?.value, "Anal"); // 2/3, highest count
  });

  it("floors weight at 0.1 so a rule that made the cut is never a no-op", () => {
    const items = Array.from({ length: 21 }, (_, i) => ({
      title: title(i === 0 ? ["Rare"] : []),
      screenshots: screenshots(),
    }));
    const rules = suggestRulesFromAnalyses(items, 1);
    assert.deepEqual(rules, [{ type: "tag", value: "Rare", weight: 0.1 }]);
  });

  it("only ever produces non-negative weights", () => {
    const items = [{ title: title(["Anal"]), screenshots: screenshots() }];
    const rules = suggestRulesFromAnalyses(items, 5);
    for (const rule of rules) assert.ok(rule.weight > 0);
  });
});

describe("pickRandomSample", () => {
  it("returns exactly `count` distinct elements from the input", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const sample = pickRandomSample(items, 5);
    assert.equal(sample.length, 5);
    assert.equal(new Set(sample).size, 5);
    for (const v of sample) assert.ok(items.includes(v));
  });

  it("clamps count to the input length", () => {
    const items = [1, 2, 3];
    const sample = pickRandomSample(items, 10);
    assert.equal(sample.length, 3);
    assert.deepEqual([...sample].sort(), [1, 2, 3]);
  });

  it("does not mutate the input array", () => {
    const items = [1, 2, 3, 4, 5];
    const copy = [...items];
    pickRandomSample(items, 3);
    assert.deepEqual(items, copy);
  });
});
