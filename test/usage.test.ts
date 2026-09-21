import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { UsageStore } from "../src/core/usage.js";
import { AppContext } from "../src/core/server/context.js";

describe("UsageStore", () => {
  it("counts active time and persists it by local calendar day", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-usage-"));
    const dayOneStart = new Date(2026, 8, 21, 23, 59, 30).getTime();
    const dayTwoEnd = dayOneStart + 60_000;
    try {
      const store = new UsageStore(root, () => dayTwoEnd);
      store.setActive(true, dayOneStart);
      assert.equal(store.getStats(dayOneStart + 10_000).days.at(-1)?.seconds, 10);

      store.setActive(false, dayTwoEnd);
      const stats = store.getStats(dayTwoEnd);
      assert.equal(stats.days.at(-2)?.seconds, 30);
      assert.equal(stats.days.at(-1)?.seconds, 30);
      assert.equal(stats.totalSeconds, 60);
      store.close();

      const reloaded = new UsageStore(root, () => dayTwoEnd);
      assert.equal(reloaded.getStats(dayTwoEnd).totalSeconds, 60);
      reloaded.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns a complete fourteen-day window, including zero-use days", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-usage-"));
    const now = new Date(2026, 8, 21, 12, 0, 0).getTime();
    try {
      const store = new UsageStore(root, () => now);
      const stats = store.getStats(now);
      assert.equal(stats.days.length, 14);
      assert.equal(stats.days[0]?.date, "2026-09-08");
      assert.equal(stats.days.at(-1)?.date, "2026-09-21");
      assert.equal(stats.totalSeconds, 0);
      store.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("follows the screen-time config toggle for an active window", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-usage-config-"));
    const app = new AppContext("", root);
    try {
      app.setWindowActive(true);
      assert.equal(app.getUsageStore().getStats().active, true);

      app.saveConfig({ ...app.loadConfig(), screenTime: { enabled: false } });
      assert.equal(app.getUsageStore().getStats().active, false);

      app.saveConfig({ ...app.loadConfig(), screenTime: { enabled: true } });
      assert.equal(app.getUsageStore().getStats().active, true);
    } finally {
      app.getUsageStore().close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
