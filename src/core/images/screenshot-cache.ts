import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// On-disk LRU-ish cache for fetched+resized topic screenshots (see
// src/ai/screenshot-analyzer.ts), so re-analyzing the same topic doesn't
// re-fetch and re-resize images it already has. Size-bounded rather than
// count-bounded — see AiConfig.screenshots.cacheMaxSizeMB (src/core/types.ts).

const CACHE_DIR_NAME = "screenshot-cache";

export function resolveScreenshotCacheDir(userDataDir: string): string {
  return path.join(userDataDir, CACHE_DIR_NAME);
}

function cacheFileName(cacheKey: string): string {
  return `${crypto.createHash("md5").update(cacheKey).digest("hex")}.jpg`;
}

// Reading a cached entry also bumps its mtime, so eviction below removes the
// least-recently-*used* files rather than the least-recently-*written* ones.
export function readCachedScreenshot(cacheDir: string, cacheKey: string): Buffer | null {
  const filePath = path.join(cacheDir, cacheFileName(cacheKey));
  try {
    const bytes = fs.readFileSync(filePath);
    const now = new Date();
    fs.utimesSync(filePath, now, now);
    return bytes;
  } catch {
    return null;
  }
}

export function writeCachedScreenshot(cacheDir: string, cacheKey: string, bytes: Buffer, maxSizeMB: number): void {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, cacheFileName(cacheKey)), bytes);
    evictOldest(cacheDir, maxSizeMB * 1024 * 1024);
  } catch {
    // Best-effort cache — a write/eviction failure shouldn't break analysis.
  }
}

function evictOldest(cacheDir: string, maxSizeBytes: number): void {
  const entries = fs
    .readdirSync(cacheDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(cacheDir, entry.name);
      const stats = fs.statSync(filePath);
      return { filePath, size: stats.size, mtimeMs: stats.mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  let totalSize = entries.reduce((sum, entry) => sum + entry.size, 0);
  for (const entry of entries) {
    if (totalSize <= maxSizeBytes) break;
    fs.unlinkSync(entry.filePath);
    totalSize -= entry.size;
  }
}
