import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";
import { getDefaultConfig } from "../src/config/store.js";
import type { Config } from "../src/core/types.js";

function setup() {
  const elements = new Map<string, { checked: boolean; value: string; hidden: boolean; disabled: boolean; textContent: string; innerHTML: string; style: object; addEventListener: (event: string, callback: () => Promise<void>) => void; handlers: Record<string, () => Promise<void>> }>();
  function element(id: string) {
    if (!elements.has(id)) {
      const handlers: Record<string, () => Promise<void>> = {};
      elements.set(id, { checked: true, value: "", hidden: false, disabled: false, textContent: "", innerHTML: "", style: {}, handlers,
        addEventListener(event, callback) { handlers[event] = callback; } });
    }
    return elements.get(id)!;
  }
  const state = { saved: getDefaultConfig(), saveOk: true };
  const requests: { url: string; method: string; body?: Config }[] = [];
  const statuses: { text: string; error: boolean }[] = [];
  const context = vm.createContext({
    config: structuredClone(state.saved), isRunning: false,
    window: { location: { origin: "http://localhost" } },
    document: { getElementById: element },
    t: (text: string) => text,
    showStatus: (_element: unknown, text: string, error: boolean) => statuses.push({ text, error }),
    fetch: async (url: string, options?: { method: string; body?: string }) => {
      const body = options?.body ? JSON.parse(options.body) as Config : undefined;
      requests.push({ url, method: options?.method ?? "GET", body });
      if (body && state.saveOk) state.saved = body;
      return { ok: !body || state.saveOk, json: async () => url === "/api/config" ? structuredClone(state.saved) : {} };
    },
  });
  const configSource = readFileSync("src/config/client.js", "utf8");
  vm.runInContext(configSource.slice(0, configSource.indexOf('btnClearHiddenResults.addEventListener')), context);
  vm.runInContext(readFileSync("src/crawl/client.js", "utf8"), context);
  vm.runInContext("fillForm()", context);
  return { element, requests, state, statuses };
}

test("each panel saves only its own fields and preserves settings saved elsewhere", async () => {
  const cases = [
    ["credentials", "credentials"], ["screen-time", "screenTime"], ["duplicates", "duplicateHiding"],
    ["delay", "delay"], ["cache", "screenshotCache"], ["mcp", "mcp"], ["crawl", "pagesToScan"],
  ];
  for (const [panel, field] of cases) {
    const { element, state } = setup();
    state.saved.downloadedFolder = "/new-folder";
    const before = structuredClone(state.saved);
    element("cfg-username").value = "new-user";
    element("cfg-screen-time-enabled").checked = false;
    element("cfg-duplicate-hiding-enabled").checked = false;
    element("cfg-delay-min").value = "3000";
    element("cfg-cache-max-size").value = "400";
    element("cfg-mcp-enabled").checked = true;
    element("cfg-pages").value = "5";
    if (panel === "screen-time" || panel === "mcp") {
      await element(panel === "screen-time" ? "cfg-screen-time-enabled" : "cfg-mcp-enabled").handlers.change();
    } else {
      await element(`btn-save-${panel}`).handlers.click();
    }
    assert.notDeepEqual(state.saved[field as keyof Config], before[field as keyof Config], panel);
    for (const key of Object.keys(before) as (keyof Config)[]) {
      if (key !== field) assert.deepEqual(state.saved[key], before[key], `${panel} must preserve ${key}`);
    }
    assert.equal(element("screen-time-indicator").hidden, panel === "screen-time");
  }
});

test("simultaneous panel saves preserve both changes", async () => {
  const { element, state } = setup();
  element("cfg-username").value = "new-user";
  element("cfg-cache-max-size").value = "400";
  await Promise.all([element("btn-save-credentials").handlers.click(), element("btn-save-cache").handlers.click()]);
  assert.equal(state.saved.credentials.username, "new-user");
  assert.equal(state.saved.screenshotCache.maxSizeMB, 400);
});

test("failed automatic saves restore the toggles and allow retry", async () => {
  for (const [input, field] of [["cfg-screen-time-enabled", "screenTime"], ["cfg-mcp-enabled", "mcp"]] as const) {
    const { element, state, statuses } = setup();
    const previous = state.saved[field].enabled;
    element(input).checked = !previous;
    state.saveOk = false;
    await element(input).handlers.change();
    assert.equal(state.saved[field].enabled, previous);
    assert.equal(element(input).checked, previous);
    assert.equal(element(input).disabled, false);
    assert.equal(element("screen-time-indicator").hidden, false);
    assert.equal(statuses.at(-1)?.error, true);
    state.saveOk = true;
    element(input).checked = !previous;
    await element(input).handlers.change();
    assert.equal(state.saved[field].enabled, !previous);
    assert.equal(element("screen-time-indicator").hidden, field === "screenTime");
  }
});

test("Start Crawl requires saved crawl settings and never saves other panels", async () => {
  const { element, requests, state } = setup();
  element("cfg-pages").value = "5";
  await element("btn-start").handlers.click();
  assert.equal(requests.length, 0);
  assert.match(element("progress-log").textContent, /Save crawl settings/);
  assert.equal(element("btn-start").disabled, false);
  await element("btn-save-crawl").handlers.click();
  requests.length = 0;
  element("cfg-username").value = "unsaved-user";
  await element("btn-start").handlers.click();
  assert.deepEqual(requests.map(({ url }) => url), ["/api/crawl"]);
  assert.equal(state.saved.credentials.username, "");
  assert.equal(state.saved.pagesToScan, 5);
});

test("changing language stores the choice and reloads the app", () => {
  const handlers = new Map<string, () => void>();
  const stored: string[][] = [];
  let reloads = 0;
  const picker = { value: "", addEventListener: (event: string, callback: () => void) => handlers.set(`picker:${event}`, callback) };
  const context = vm.createContext({
    getLocale: () => "en",
    document: { getElementById: (id: string) => id === "cfg-language" ? picker : {
      addEventListener: (event: string, callback: () => void) => handlers.set(`save:${event}`, callback),
    } },
    window: { localStorage: { setItem: (...args: string[]) => stored.push(args) }, location: { reload: () => reloads++ } },
  });
  const source = readFileSync("src/core/ui/i18n.js", "utf8");
  vm.runInContext(source.slice(source.indexOf("function setupLocalePicker()"), source.indexOf("\napplyTranslations();")), context);
  vm.runInContext("setupLocalePicker()", context);
  picker.value = "ru";
  assert.equal(handlers.has("save:click"), false);
  assert.equal(stored.length, 0);
  handlers.get("picker:change")!();
  assert.deepEqual(stored, [["prnlb-locale", "ru"]]);
  assert.equal(reloads, 1);
});
