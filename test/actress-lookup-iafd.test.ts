import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePersonPage, parseSearchMatches, stripParenthetical } from "../src/core/actress-lookup/iafd.js";

// A trimmed but real excerpt of the "Performers > Females" table from
// https://www.iafd.com/results.asp?searchtype=comprehensive&searchstring=Megan+Murkovski
const SEARCH_RESULTS_HTML = `
<h3>Females</h3><div id="tblFem_wrapper" class="dataTables_wrapper no-footer">
<table id="tblFem" class="table display table-responsive dataTable no-footer" aria-describedby="tblFem_info">
<thead><tr><th>Headshot</th><th>Name</th><th>AKA</th><th>Start</th><th>End</th><th>Titles</th></tr></thead>
<tbody><tr class="odd"><td><a href="/person.rme/id=e5fea71b-0792-4d43-b9df-5e1d861c1c8d"><img align="left" height="100" width="85" src="https://www.iafd.com/graphics/headshots/meganmurkovski_f_0153.jpg"></a></td><td><a href="/person.rme/id=e5fea71b-0792-4d43-b9df-5e1d861c1c8d">Megan Murkovski</a></td><td class="text-left">Megan Longoria, Megan M (nubiles.net)</td><td class="text-center">2024</td><td class="text-center">2026</td><td class="text-center">66</td></tr></tbody>
</table></div>
`;

// A trimmed but real excerpt of the performer detail page at
// https://www.iafd.com/person.rme/id=e5fea71b-0792-4d43-b9df-5e1d861c1c8d
const PERSON_PAGE_HTML = `
<h1>Megan Murkovski
</h1>
<div id="headshot"><img title="Photo of Megan Murkovski" alt="Photo of Megan Murkovski" src="https://www.iafd.com/graphics/headshots/meganmurkovski_f_0153.jpg"></div>
<p class="headshotcaption"><a href="http://nubiles.net/">Photo Copyright/Courtesy of<br>nubiles.net</a></p>
<p class="bioheading">
Performer
AKA</p><div class="biodata">
\t\tMegan Longoria<br>Megan M (nubiles.net)

</div>
<p class="bioheading">Birthday</p><p class="biodata"><a href="/calendar.asp">March 17, 2003</a> (23 years old)</p>
`;

describe("iafd parseSearchMatches", () => {
  it("extracts one match per row in the Females table", () => {
    const matches = parseSearchMatches(SEARCH_RESULTS_HTML);
    assert.deepEqual(matches, [
      {
        title: "/person.rme/id=e5fea71b-0792-4d43-b9df-5e1d861c1c8d",
        url: "https://www.iafd.com/person.rme/id=e5fea71b-0792-4d43-b9df-5e1d861c1c8d",
      },
    ]);
  });

  it("returns an empty list when the Females table is absent", () => {
    assert.deepEqual(parseSearchMatches("<p>No results</p>"), []);
  });
});

describe("iafd parsePersonPage", () => {
  it("extracts the primary name, AKA list, and headshot", () => {
    const { name, otherNames, imageUrl } = parsePersonPage(PERSON_PAGE_HTML);
    assert.equal(name, "Megan Murkovski");
    assert.deepEqual(otherNames, ["Megan Longoria", "Megan M"]);
    assert.equal(imageUrl, "https://www.iafd.com/graphics/headshots/meganmurkovski_f_0153.jpg");
  });

  it("returns nulls/empty when the page has no bio", () => {
    const { name, otherNames, imageUrl } = parsePersonPage("<p>Just plain page text.</p>");
    assert.equal(name, null);
    assert.deepEqual(otherNames, []);
    assert.equal(imageUrl, null);
  });
});

describe("iafd stripParenthetical", () => {
  it("removes a trailing site-credit annotation", () => {
    assert.equal(stripParenthetical("Megan M (nubiles.net)"), "Megan M");
  });

  it("leaves plain names untouched", () => {
    assert.equal(stripParenthetical("Megan Longoria"), "Megan Longoria");
  });
});
