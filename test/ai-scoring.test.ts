import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeScore } from "../src/ai/scoring.js";
import type { ScreenshotAnalysis, TitleAnalysis } from "../src/ai/types.js";

function title(overrides: Partial<TitleAnalysis> = {}): TitleAnalysis {
  return { actresses: [], tags: [], quality: "unknown", ...overrides };
}

function screenshots(overrides: Partial<ScreenshotAnalysis> = {}): ScreenshotAnalysis {
  return { tags: [], performers: [], ...overrides };
}

describe("computeScore", () => {
  it("returns null when no rules are configured", () => {
    assert.equal(computeScore([], title(), screenshots()), null);
  });

  it("returns the neutral baseline when rules exist but none match", () => {
    const score = computeScore([{ type: "tag", value: "anal", weight: 1 }], title({ tags: ["pov"] }), screenshots());
    assert.equal(score, 50);
  });

  it("saturates to 100 on a single fully-positive matching rule", () => {
    const score = computeScore(
      [{ type: "tag", value: "anal", weight: 1 }],
      title({ tags: ["anal sex"] }),
      screenshots(),
    );
    assert.equal(score, 100);
  });

  it("saturates to 0 on a single fully-negative matching rule", () => {
    const score = computeScore(
      [{ type: "tag", value: "anal", weight: -1 }],
      title({ tags: ["anal sex"] }),
      screenshots(),
    );
    assert.equal(score, 0);
  });

  it("matches tag rules case-insensitively as a substring across title and screenshot tags", () => {
    const score = computeScore(
      [{ type: "tag", value: "ANAL", weight: 0.4 }],
      title(),
      screenshots({ tags: ["hardcore anal scene"] }),
    );
    assert.equal(score, 70);
  });

  it("matches performer-characteristic rules against any performer's fields", () => {
    const score = computeScore(
      [{ type: "performer-characteristic", value: "blonde", weight: 0.5 }],
      title(),
      screenshots({
        performers: [
          { hairColor: "brunette", hairLength: "long", bodyType: "slim", age: "23-27", race: "caucasian", breastSize: "medium" },
          { hairColor: "blonde", hairLength: "short", bodyType: "athletic", age: "18-22", race: "asian", breastSize: "small" },
        ],
      }),
    );
    assert.equal(score, 75);
  });

  it("sums multiple matched rule weights before clamping", () => {
    const score = computeScore(
      [
        { type: "tag", value: "anal", weight: 0.5 },
        { type: "tag", value: "pov", weight: 0.5 },
        { type: "tag", value: "amateur", weight: -0.2 },
      ],
      title({ tags: ["anal", "pov"] }),
      screenshots(),
    );
    // 50 + (0.5 + 0.5) * 50 = 100, "amateur" doesn't match so its weight is excluded
    assert.equal(score, 100);
  });

  it("does not let TitleAnalysis.actresses participate in scoring", () => {
    const score = computeScore(
      [{ type: "tag", value: "jane doe", weight: 1 }],
      title({ actresses: ["Jane Doe"], tags: [] }),
      screenshots(),
    );
    assert.equal(score, 50);
  });
});
