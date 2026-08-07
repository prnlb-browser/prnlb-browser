import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { postProcess, type RawPerformer, type RawScreenshotResult } from "../src/ai/screenshot-analyzer.js";

function performer(overrides: Partial<RawPerformer> = {}): RawPerformer {
  return {
    gender: "female",
    hairColor: "unknown",
    hairLength: "unknown",
    bodyType: "unknown",
    age: "unknown",
    race: "unknown",
    breastSize: "unknown",
    ...overrides,
  };
}

function raw(tags: string[], performers: RawPerformer[]): RawScreenshotResult {
  return { tags, performers };
}

describe("postProcess", () => {
  it("adds 'Solo' for exactly 1 performer", () => {
    assert.deepEqual(postProcess(raw([], [performer()])).tags, ["Solo"]);
  });

  it("adds 'Duo' + gender-composition tag for exactly 2 performers", () => {
    assert.deepEqual(postProcess(raw([], [performer(), performer()])).tags, ["Duo", "FF"]);
    assert.deepEqual(
      postProcess(raw([], [performer({ gender: "male" }), performer({ gender: "male" })])).tags,
      ["Duo", "MM"],
    );
    assert.deepEqual(
      postProcess(raw([], [performer(), performer({ gender: "male" })])).tags,
      ["Duo", "MF"],
    );
  });

  it("adds 'Threesome' + 'FFF'/'MMM' for a same-gender trio", () => {
    assert.deepEqual(postProcess(raw([], [performer(), performer(), performer()])).tags, ["Threesome", "FFF"]);
    assert.deepEqual(
      postProcess(raw([], [performer({ gender: "male" }), performer({ gender: "male" }), performer({ gender: "male" })])).tags,
      ["Threesome", "MMM"],
    );
  });

  it("adds 'Threesome' + 'FFM' for two females and one male", () => {
    const result = postProcess(
      raw([], [performer({ gender: "female" }), performer({ gender: "female" }), performer({ gender: "male" })]),
    );
    assert.deepEqual(result.tags, ["Threesome", "FFM"]);
  });

  it("adds 'Threesome' + 'MMF' for two males and one female", () => {
    const result = postProcess(
      raw([], [performer({ gender: "male" }), performer({ gender: "male" }), performer({ gender: "female" })]),
    );
    assert.deepEqual(result.tags, ["Threesome", "MMF"]);
  });

  it("adds 'Gangbang' (not 'Threesome') for more than 3 performers", () => {
    const result = postProcess(raw([], [performer(), performer(), performer(), performer()]));
    assert.deepEqual(result.tags, ["Gangbang"]);
  });

  it("does not add 'FFM'/'MMF' for a 4-performer scene even with a 2F/1M-like split among others", () => {
    const result = postProcess(
      raw([], [performer({ gender: "female" }), performer({ gender: "female" }), performer({ gender: "male" }), performer({ gender: "male" })]),
    );
    assert.deepEqual(result.tags, ["Gangbang"]);
  });

  it("merges derived tags with the model's own tags, deduping case-insensitively", () => {
    const result = postProcess(
      raw(["pov", "threesome"], [performer(), performer({ gender: "female" }), performer({ gender: "male" })]),
    );
    assert.deepEqual(result.tags, ["pov", "threesome", "FFM"]);
  });

  it("keeps only female performers in the output, and strips the gender field", () => {
    const male = performer({ gender: "male", hairColor: "black" });
    const female = performer({ gender: "female", hairColor: "blonde", breastSize: "large" });
    const result = postProcess(raw([], [female, male]));
    assert.equal(result.performers.length, 1);
    assert.deepEqual(result.performers[0], {
      hairColor: "blonde",
      hairLength: "unknown",
      bodyType: "unknown",
      age: "unknown",
      race: "unknown",
      breastSize: "large",
    });
    assert.ok(!("gender" in result.performers[0]));
  });

  it("handles an empty performers array (no scene tag, empty output)", () => {
    const result = postProcess(raw(["solo"], []));
    assert.deepEqual(result, { tags: ["solo"], performers: [] });
  });
});
