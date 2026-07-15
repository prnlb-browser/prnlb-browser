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
  };
}

export class ConfigStore {
  constructor(private readonly userDataDir: string) {}

  get path(): string {
    return path.join(this.userDataDir, "config.json");
  }

  load(): Config {
    try {
      return JSON.parse(fs.readFileSync(this.path, "utf-8")) as Config;
    } catch {
      return getDefaultConfig();
    }
  }

  save(config: Config): void {
    fs.writeFileSync(this.path, JSON.stringify(config, null, 2), "utf-8");
  }
}
