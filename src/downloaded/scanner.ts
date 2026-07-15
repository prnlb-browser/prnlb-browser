import * as fs from "node:fs";
import * as path from "node:path";

export const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".webm",
  ".m4v", ".ts", ".mpg", ".mpeg", ".rmvb", ".rm",
]);

export function findVideoFiles(rootDir: string): string[] {
  const videoFiles: string[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        videoFiles.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return videoFiles;
}

export function filenameToSearchQuery(fileName: string): string {
  return path.parse(fileName).name.replace(/[._\-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function prepareImagesDirectory(folderPath: string, clean = false): string {
  const imagesDir = path.join(folderPath, ".images");
  fs.mkdirSync(imagesDir, { recursive: true });
  if (clean) {
    for (const entry of fs.readdirSync(imagesDir, { withFileTypes: true })) {
      if (entry.isFile()) fs.unlinkSync(path.join(imagesDir, entry.name));
    }
  }
  return imagesDir;
}

// Read OS-level stats for a single downloaded item's file. Returns nulls when
// the file is missing or unreadable so callers can still surface the row.
export function readFileStats(filePath: string): {
  fileSizeBytes: number | null;
  fileMtimeMs: number | null;
  fileBirthtimeMs: number | null;
} {
  try {
    const stat = fs.statSync(filePath);
    return {
      fileSizeBytes: stat.size,
      fileMtimeMs: stat.mtimeMs,
      // birthtime is not always reliable; fall back to mtime on platforms
      // (or filesystems) where it is unset.
      fileBirthtimeMs: stat.birthtimeMs && stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs,
    };
  } catch {
    return { fileSizeBytes: null, fileMtimeMs: null, fileBirthtimeMs: null };
  }
}

// Enrich an array of items (mutates and returns them) with OS-level file
// stats. Missing files produce nulls rather than throwing.
export function enrichItemsWithFileStats<T extends { filePath: string }>(items: T[]): T[] {
  for (const item of items) {
    const stats = readFileStats(item.filePath);
    (item as T & { fileSizeBytes: number | null; fileMtimeMs: number | null; fileBirthtimeMs: number | null }).fileSizeBytes = stats.fileSizeBytes;
    (item as T & { fileSizeBytes: number | null; fileMtimeMs: number | null; fileBirthtimeMs: number | null }).fileMtimeMs = stats.fileMtimeMs;
    (item as T & { fileSizeBytes: number | null; fileMtimeMs: number | null; fileBirthtimeMs: number | null }).fileBirthtimeMs = stats.fileBirthtimeMs;
  }
  return items;
}
