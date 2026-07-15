import * as path from "node:path";
import * as fs from "node:fs";
import { chromium as pwChromium } from "playwright-core";
import type { LaunchOptions, Browser } from "playwright-core";

let configured = false;

/**
 * Ensure PLAYWRIGHT_BROWSERS_PATH is set so playwright-core can find
 * the bundled Chromium.  Called once per process lifetime.
 *
 * Resolution order:
 * 1. If PLAYWRIGHT_BROWSERS_PATH is already set (e.g. by electron.ts),
 *    leave it alone.
 * 2. Packaged Electron app → process.resourcesPath/browsers/
 * 3. Development → project root browsers/ (three levels up from dist/src/core/)
 */
function ensureBrowserPath(): void {
  if (configured) return;
  configured = true;

  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return;

  // Try Electron's resourcesPath first (works in both packaged and dev)
  if (process.resourcesPath) {
    const dir = path.join(process.resourcesPath, "browsers");
    if (fs.existsSync(dir)) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = dir;
      return;
    }
  }

  // Fallback: project root browsers/ dir (three levels up from dist/src/core/)
  const devDir = path.resolve(__dirname, "..", "..", "..", "browsers");
  if (fs.existsSync(devDir)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = devDir;
  }
}

/**
 * Launch a Chromium browser using playwright-core.
 * Automatically resolves the bundled browser path when running
 * as a packaged Electron app or with the local `browsers/` directory.
 */
export async function launchChromium(
  options: LaunchOptions = {},
): Promise<Browser> {
  ensureBrowserPath();
  return pwChromium.launch(options);
}
