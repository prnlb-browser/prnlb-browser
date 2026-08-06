import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchActresses } from "../src/core/actress-match.js";
import type { Actress } from "../src/core/types.js";

function actress(overrides: Partial<Actress> = {}): Actress {
  return {
    id: 1,
    name: "Jane Doe",
    otherNames: [],
    postImage: null,
    cachedImage: null,
    isFavorite: false,
    createdAt: "2026-01-01",
    ...overrides,
  };
}

describe("matchActresses", () => {
  it("matches an actress by name in the Cast (starring) text, case-insensitively", () => {
    const jane = actress({ id: 1, name: "Jane Doe" });
    const ctx = matchActresses("Some Title", "Jane doe, Bob Smith", [jane]);
    assert.deepEqual(ctx.matchedNames, ["Jane Doe"]);
  });

  it("matches an actress by alias (otherNames) too", () => {
    const jane = actress({ id: 1, name: "Jane Doe", otherNames: ["Janie D"] });
    const ctx = matchActresses("Some Title", "Featuring Janie D", [jane]);
    assert.deepEqual(ctx.matchedNames, ["Jane Doe"]);
  });

  it("also searches the title, not just starring", () => {
    const jane = actress({ id: 1, name: "Jane Doe" });
    const ctx = matchActresses("[Site] Jane Doe - A Scene", null, [jane]);
    assert.deepEqual(ctx.matchedNames, ["Jane Doe"]);
  });

  it("strips parenthetical annotations (and their contents) from the Cast text before matching", () => {
    // stripCastAnnotation removes "(...)" wholesale, so a name that only
    // appears inside parens — e.g. a scene-type annotation like
    // "Jane Doe (Solo)" — must NOT match on the parenthetical content.
    const solo = actress({ id: 1, name: "Solo" });
    const jane = actress({ id: 2, name: "Jane Doe" });
    const ctx = matchActresses("Title", "Jane Doe (Solo)", [solo, jane]);
    assert.deepEqual(ctx.matchedNames, ["Jane Doe"]);
  });

  it("reports favorite matches separately from all matches", () => {
    const fav = actress({ id: 1, name: "Fav Actress", isFavorite: true });
    const notFav = actress({ id: 2, name: "Other Actress", isFavorite: false });
    const ctx = matchActresses("Title", "Fav Actress, Other Actress", [fav, notFav]);
    assert.deepEqual(ctx.matchedNames.sort(), ["Fav Actress", "Other Actress"]);
    assert.deepEqual(ctx.matchedFavoriteNames, ["Fav Actress"]);
  });

  it("returns empty arrays when nothing matches or starring is null", () => {
    const jane = actress({ id: 1, name: "Jane Doe" });
    const ctx = matchActresses("Unrelated Title", null, [jane]);
    assert.deepEqual(ctx.matchedNames, []);
    assert.deepEqual(ctx.matchedFavoriteNames, []);
  });
});
