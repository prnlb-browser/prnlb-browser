import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeTitle } from "../src/ai/title-analyzer.js";
import type { AiProviderClient } from "../src/ai/providers/types.js";

function mockClient(response: unknown): AiProviderClient {
  return {
    completeJson: async () => response as never,
  };
}

describe("analyzeTitle", () => {
  it("strips the date, resolution token, and release-format word out of tags even if the model includes them", async () => {
    const title =
      "[LegalPorno.com / AnalVids.com / PornBox.com / Princess lili] Olivia Westsun, Princess Lili - I Let My Stepbrother Fuck Me in the Ass So I Could Stay a Virgin (4939126) [2026-07-04, Anal, Big Tits, Fingering, Hardcore, Lingerie, Natural Tits, POV, Petite, Piercing, Russian Girls, Tattoos, Threesome (FFM), Brown Hair, Young, Anal Creampie, Face Fucking, Balls Licking, 1080p, SiteRip]";

    // Simulates an imperfect raw model reply that still leaked the date,
    // "1080p", and "SiteRip" into tags, and kept the "(FFM)" qualifier —
    // exactly the noise the deterministic cleanup step exists to catch.
    const rawModelOutput = {
      actresses: ["Olivia Westsun", "Princess Lili"],
      tags: [
        "2026-07-04",
        "Anal",
        "Big Tits",
        "Fingering",
        "Hardcore",
        "Lingerie",
        "Natural Tits",
        "POV",
        "Petite",
        "Piercing",
        "Russian Girls",
        "Tattoos",
        "Threesome (FFM)",
        "Brown Hair",
        "Young",
        "Anal Creampie",
        "Face Fucking",
        "Balls Licking",
        "1080p",
        "SiteRip",
      ],
      quality: "1080p",
    };

    const result = await analyzeTitle(title, mockClient(rawModelOutput));

    assert.deepEqual(result.actresses, ["Olivia Westsun", "Princess Lili"]);
    assert.equal(result.quality, "1080p");
    assert.deepEqual(result.tags, [
      "Anal",
      "Big Tits",
      "Fingering",
      "Hardcore",
      "Lingerie",
      "Natural Tits",
      "POV",
      "Petite",
      "Piercing",
      "Russian Girls",
      "Tattoos",
      "Threesome",
      "Brown Hair",
      "Young",
      "Anal Creampie",
      "Face Fucking",
      "Balls Licking",
    ]);
  });

  it("handles a title with no parenthetical tag qualifiers the same way", async () => {
    const title =
      "[LegalPorno.com / PornBox.com / MurkovskiHub] Luna Rishi - Fucked the redhead and came in her mouth. (4943175) [2026-07-16, Couples, Cunnilingus, Doggystyle, Facial, Hardcore, Handjob, Lingerie, Natural Tits, Petite, Redhead, Russian Girls, Skinny, Straight, Tattoos, Small Tits, Young, Cowgirl, Balls Licking, 1080p, SiteRip]";

    const rawModelOutput = {
      actresses: ["Luna Rishi"],
      tags: [
        "2026-07-16",
        "Couples",
        "Cunnilingus",
        "Doggystyle",
        "Facial",
        "Hardcore",
        "Handjob",
        "Lingerie",
        "Natural Tits",
        "Petite",
        "Redhead",
        "Russian Girls",
        "Skinny",
        "Straight",
        "Tattoos",
        "Small Tits",
        "Young",
        "Cowgirl",
        "Balls Licking",
        "1080p",
        "SiteRip",
      ],
      quality: "1080p",
    };

    const result = await analyzeTitle(title, mockClient(rawModelOutput));

    assert.deepEqual(result.actresses, ["Luna Rishi"]);
    assert.equal(result.quality, "1080p");
    assert.deepEqual(result.tags, [
      "Couples",
      "Cunnilingus",
      "Doggystyle",
      "Facial",
      "Hardcore",
      "Handjob",
      "Lingerie",
      "Natural Tits",
      "Petite",
      "Redhead",
      "Russian Girls",
      "Skinny",
      "Straight",
      "Tattoos",
      "Small Tits",
      "Young",
      "Cowgirl",
      "Balls Licking",
    ]);
  });

  it("dedupes tags and actresses case-insensitively", async () => {
    const result = await analyzeTitle(
      "irrelevant",
      mockClient({
        actresses: ["Jane Doe", "jane doe", " Jane Doe "],
        tags: ["Anal", "anal", "ANAL "],
        quality: "unknown",
      }),
    );
    assert.deepEqual(result.actresses, ["Jane Doe"]);
    assert.deepEqual(result.tags, ["Anal"]);
  });

  it("drops empty/whitespace-only entries", async () => {
    const result = await analyzeTitle(
      "irrelevant",
      mockClient({ actresses: ["", "  ", "Jane Doe"], tags: ["", "  ", "Anal"], quality: "unknown" }),
    );
    assert.deepEqual(result.actresses, ["Jane Doe"]);
    assert.deepEqual(result.tags, ["Anal"]);
  });
});
