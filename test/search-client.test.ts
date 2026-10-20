import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

function setup() {
  const options = [
    { value: "-1", textContent: "Everywhere", selected: true },
    { value: "1", textContent: "Category", selected: false },
    { value: "2", textContent: "|- First child", selected: false },
    { value: "3", textContent: "|- Second child", selected: false },
    { value: "4", textContent: "Standalone forum", selected: false },
    { value: "5", textContent: "Another category", selected: false },
    { value: "6", textContent: "|- Another child", selected: false },
  ];
  let change = () => {};
  const filter = { options, get selectedOptions() { return options.filter((option) => option.selected); },
    addEventListener(_event: string, handler: () => void) { change = handler; } };
  const context = vm.createContext({ document: { getElementById: (id: string) => id === "filter-search-forum" ? filter : {} } });
  const source = readFileSync("src/search/client.js", "utf8");
  vm.runInContext(source.slice(0, source.indexOf("async function performSearch")), context);
  return {
    select(ids: string[]) { options.forEach((option) => { option.selected = ids.includes(option.value); }); change(); },
    selected() { return options.filter((option) => option.selected).map((option) => option.value); },
    forums() { const result = vm.runInContext("getSelectedSearchForums()", context); return result && Array.from(result); },
  };
}

test("selecting a plain parent selects its |- children and stops at the next plain forum", () => {
  const filter = setup();
  filter.select(["1"]);
  assert.deepEqual(filter.selected(), ["1", "2", "3"]);
  assert.deepEqual(filter.forums(), [1, 2, 3]);
});

test("standalone forums and individual children do not select siblings", () => {
  for (const id of ["2", "4"]) {
    const filter = setup();
    filter.select([id]);
    assert.deepEqual(filter.selected(), [id]);
  }
});

test("multiple parents expand independently and Everywhere does not override a new forum selection", () => {
  const filter = setup();
  filter.select(["-1", "1", "5"]);
  assert.deepEqual(filter.selected(), ["1", "2", "3", "5", "6"]);
  filter.select(["-1", "1", "2", "3", "5", "6"]);
  assert.deepEqual(filter.selected(), ["-1"]);
  assert.equal(filter.forums(), undefined);
});

test("a child can be deselected after selecting its parent", () => {
  const filter = setup();
  filter.select(["1"]);
  filter.select(["1", "3"]);
  assert.deepEqual(filter.selected(), ["1", "3"]);
});
