import * as fs from "node:fs";
import * as path from "node:path";
import type { Config } from "../core/types.js";

export function getDefaultConfig(): Config {
  return {
    credentials: { username: "", password: "" },
    forums: [],
    pagesToScan: 2,
    headless: true,
    delay: { min: 2000, max: 5000 },
    dbPath: "data.db",
    downloadedFolder: "",
    screenshotCache: { maxSizeMB: 200 },
  };
}

export class ConfigStore {
  constructor(private readonly userDataDir: string) {}

  get path(): string {
    return path.join(this.userDataDir, "config.json");
  }

  load(): Config {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.path, "utf-8")) as Partial<Config> & { ai?: unknown };
      // Backfill `screenshotCache` for configs saved before that field existed.
      const defaultConfig = getDefaultConfig();
      const { ai: _legacyAi, ...configWithoutAi } = parsed;
      return {
        ...configWithoutAi,
        screenshotCache: { ...defaultConfig.screenshotCache, ...parsed.screenshotCache },
      } as Config;
    } catch {
      return getDefaultConfig();
    }
  }

  save(config: Config): void {
    const cleanConfig = { ...config } as Config & { ai?: unknown };
    delete cleanConfig.ai;
    fs.writeFileSync(this.path, JSON.stringify(cleanConfig, null, 2), "utf-8");
  }
}
