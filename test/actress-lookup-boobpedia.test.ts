import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseBiobox, resolvePrimaryName } from "../src/core/actress-lookup/boobpedia.js";

// A trimmed but real excerpt of Boobpedia's wikitext for the "Angela White"
// page, captured via action=parse&prop=wikitext. Exercises alias parsing,
// ref-stripping, and the photo File: link.
const ANGELA_WHITE_WIKITEXT = `{{Biobox new
|             name = Angela White
|            photo = [[File:Angela White 01.jpg|240px]]
|            alias = Angela, Angie

|      birth month = 03
|        birth day = 04
|       birth year = 1985
|        birth ref = <ref>[https://twitter.com/ANGELAWHITE/status/1631162315331743744 Tweet of {{PAGENAME}}]</ref>
|   birth location = Sydney, New South Wales, [[Australia]]<ref>[https://twitter.com/ANGELAWHITE/status/203616990139658241 Tweet of {{PAGENAME}}]</ref>

|             afdb = 42938
|          aiwards = angela-white
|             iafd = AngelaWhite
|             imdb = 1453473
|             tmdb = 1535848
|         wikidata = Q16224052
}}

'''Angela White''' (born March 4, 1985, in Sydney, Australia) is an Australian [[porn star]].`;

describe("boobpedia parseBiobox", () => {
  it("extracts the primary name, aliases, and photo filename from a Biobox", () => {
    const { name, alias, photoFile } = parseBiobox(ANGELA_WHITE_WIKITEXT);
    assert.equal(name, "Angela White");
    assert.deepEqual(alias, ["Angela", "Angie"]);
    assert.equal(photoFile, "Angela White 01.jpg");
  });

  it("returns nulls/empty when no Biobox is present", () => {
    const { name, alias, photoFile } = parseBiobox("Just plain article text with no infobox.");
    assert.equal(name, null);
    assert.deepEqual(alias, []);
    assert.equal(photoFile, null);
  });

  it("returns an empty alias list when the alias field is absent", () => {
    const wikitext = `{{Biobox new\n|             name = Jane Doe\n|            photo = [[File:Jane Doe 01.jpg|240px]]\n}}`;
    const { name, alias, photoFile } = parseBiobox(wikitext);
    assert.equal(name, "Jane Doe");
    assert.deepEqual(alias, []);
    assert.equal(photoFile, "Jane Doe 01.jpg");
  });

  // Regression test: a real Boobpedia excerpt (Erica Mori / "Polly Yang")
  // whose `name` field is blank previously leaked the *next* field's whole
  // line into the parsed name, because `\s*` in the field regex matches
  // newlines and greedily crossed the line boundary on an empty value.
  it("does not leak the following field's line when a field's value is blank", () => {
    const wikitext = `{{Biobox new             \n|             name =\n|            photo = [[Image:Erica Mori_01.jpg|240px]]\n|            alias = Dusya Ulet, Erika, Erika Mori, Polly Yang, Polly Yangs\n|      birth month = 8 \n}}`;
    const { name, alias, photoFile } = parseBiobox(wikitext);
    assert.equal(name, null);
    assert.deepEqual(alias, ["Dusya Ulet", "Erika", "Erika Mori", "Polly Yang", "Polly Yangs"]);
    assert.equal(photoFile, "Erica Mori_01.jpg");
  });

  it("recognizes a photo in the legacy Image: namespace, not just File:", () => {
    const wikitext = `{{Biobox new\n|             name = Jane Doe\n|            photo = [[Image:Jane Doe 01.jpg|240px]]\n}}`;
    const { photoFile } = parseBiobox(wikitext);
    assert.equal(photoFile, "Jane Doe 01.jpg");
  });
});

describe("boobpedia resolvePrimaryName", () => {
  // Regression test: searching "Polly Yang" (an alias-only match) must still
  // fill Name with "Erica Mori", the page's own canonical name — the caller
  // is responsible for folding "Polly Yang" into other names if it differs.
  it("always uses the page's own name as primary, demoting it out of the alias list", () => {
    const alias = ["Dusya Ulet", "Erika", "Erika Mori", "Polly Yang", "Polly Yangs"];
    const { primaryName, otherNames } = resolvePrimaryName("Erica Mori", alias);
    assert.equal(primaryName, "Erica Mori");
    assert.deepEqual(otherNames, ["Dusya Ulet", "Erika", "Erika Mori", "Polly Yang", "Polly Yangs"]);
  });

  it("keeps the page's own name as primary when it also appears in the alias list", () => {
    const { primaryName, otherNames } = resolvePrimaryName("Angela White", ["Angela", "Angie", "Angela White"]);
    assert.equal(primaryName, "Angela White");
    assert.deepEqual(otherNames, ["Angela", "Angie"]);
  });
});
