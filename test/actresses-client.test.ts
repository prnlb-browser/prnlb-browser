import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

function setup(imageUrl: string | null) {
  const downloads: string[] = [];
  let previews = 0;
  const context = vm.createContext({
    actressNameInput: { value: "Original Name" }, actressModalOtherNames: [],
    actressImageUrlInput: { value: "" }, actressImageStatus: {}, actressModalStatus: {},
    actressLookupButtons: [], actressModalPendingImageUrl: null,
    renderActressOtherNames: () => {}, updateActressImagePreview: () => { previews++; },
    applyActressImageUrl: async (url: string) => { downloads.push(url); },
    t: (text: string) => text, esc: (text: string) => text,
    fetch: async (url: string) => ({ ok: true, json: async () => url.includes("/search?")
      ? { matches: [{ title: "Resolved Name" }] }
      : { name: "Resolved Name", otherNames: ["Alias"], imageUrl } }),
  });
  const source = readFileSync("src/actresses/client.js", "utf8");
  vm.runInContext(source.slice(source.indexOf("async function applyActressLookupDetails("),
    source.indexOf("actressLookupButtons.forEach(({ el, provider, label })")), context);
  return { downloads, context, previews: () => previews,
    lookup: (provider: string) => vm.runInContext(`runActressLookup(${JSON.stringify(provider)}, "Provider")`, context) };
}

test("IAFD lookup resolves its picture automatically without a second button click", async () => {
  const url = "https://www.iafd.com/graphics/headshots/example.jpg";
  const state = setup(url);
  await state.lookup("iafd");
  assert.deepEqual(state.downloads, [url]);
  assert.equal(state.context.actressImageUrlInput.value, url);
  assert.equal(state.context.actressNameInput.value, "Resolved Name");
  assert.deepEqual(Array.from(state.context.actressModalOtherNames), ["Alias", "Original Name"]);
  assert.equal(state.previews(), 0);
});

test("other providers keep their direct draft preview", async () => {
  const state = setup("https://example.com/photo.jpg");
  await state.lookup("boobpedia");
  assert.deepEqual(state.downloads, []);
  assert.equal(state.previews(), 1);
  assert.equal(state.context.actressModalPendingImageUrl, "https://example.com/photo.jpg");
});

test("IAFD lookup without a photo still applies names without downloading", async () => {
  const state = setup(null);
  await state.lookup("iafd");
  assert.deepEqual(state.downloads, []);
  assert.equal(state.context.actressNameInput.value, "Resolved Name");
});
