import * as fs from "node:fs";
import * as path from "node:path";
import type { AiConfig, Config } from "../core/types.js";

export function getDefaultAiConfig(): AiConfig {
  return {
    enabled: false,
    provider: "ollama",
    ollama: { baseUrl: "http://localhost:11434", textModel: "qwen2.5:0.5b", visionModel: "qwen2.5vl:3b" },
    openrouter: { apiKey: "", textModel: "", visionModel: "" },
    scoring: { rules: [] },
    screenshots: { maxImages: 4, maxDimension: 896 },
    autoHide: { enabled: false, belowRating: 50 },
  };
}

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
    ai: getDefaultAiConfig(),
  };
}

export class ConfigStore {
  constructor(private readonly userDataDir: string) {}

  get path(): string {
    return path.join(this.userDataDir, "config.json");
  }

  load(): Config {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.path, "utf-8")) as Partial<Config>;
      // Backfill `ai` and `screenshotCache` for configs saved before those
      // fields existed, so the rest of the app can treat them as always present.
      const defaultAi = getDefaultAiConfig();
      const defaultConfig = getDefaultConfig();
      return {
        ...parsed,
        screenshotCache: { ...defaultConfig.screenshotCache, ...parsed.screenshotCache },
        ai: {
          ...defaultAi,
          ...parsed.ai,
          // AI feature temporarily disabled app-wide; ignore whatever is on
          // disk so every route/tab that reads config.ai.enabled agrees,
          // regardless of what config.json says.
          enabled: false,
          ollama: { ...defaultAi.ollama, ...parsed.ai?.ollama },
          openrouter: { ...defaultAi.openrouter, ...parsed.ai?.openrouter },
          scoring: { ...defaultAi.scoring, ...parsed.ai?.scoring },
          screenshots: { ...defaultAi.screenshots, ...parsed.ai?.screenshots },
          autoHide: { ...defaultAi.autoHide, ...parsed.ai?.autoHide },
        },
      } as Config;
    } catch {
      return getDefaultConfig();
    }
  }

  save(config: Config): void {
    fs.writeFileSync(this.path, JSON.stringify(config, null, 2), "utf-8");
  }
}
