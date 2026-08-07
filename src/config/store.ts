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
      // Backfill `ai` for configs saved before this feature existed, so the
      // rest of the app can treat Config.ai as always present.
      const defaultAi = getDefaultAiConfig();
      return {
        ...parsed,
        ai: {
          ...defaultAi,
          ...parsed.ai,
          ollama: { ...defaultAi.ollama, ...parsed.ai?.ollama },
          openrouter: { ...defaultAi.openrouter, ...parsed.ai?.openrouter },
          scoring: { ...defaultAi.scoring, ...parsed.ai?.scoring },
          screenshots: { ...defaultAi.screenshots, ...parsed.ai?.screenshots },
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
