import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Validate a user-supplied folder path. Returns a normalized absolute path on
 * success, or `{ ok: false, reason }` describing the failure.
 *
 * Reject conditions:
 * - empty / non-string
 * - not absolute (require a rooted path, no `~` or `..` segments)
 * - contains parent traversal (`..` segments)
 * - path does not exist or is not a directory
 *
 * This guard is used by the Downloaded, Actress, and any other feature that
 * stores or scans a directory chosen via the UI. It is intentionally strict
 * because the value is later used to read files (image cache, scanner
 * walks) and a single bad value could expose arbitrary files or be used to
 * point the scanner at an unintended location.
 */
export type FolderValidation =
  | { ok: true; absolutePath: string }
  | { ok: false; reason: string };

export function validateFolderPath(raw: unknown): FolderValidation {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, reason: "folderPath is required" };
  }
  const trimmed = raw.trim();
  if (!path.isAbsolute(trimmed)) {
    return { ok: false, reason: "folderPath must be an absolute path" };
  }
  // Reject any traversal segments up front; we also rely on `path.resolve`
  // below to normalize but want an explicit error for `..` to avoid silent
  // resolution surprises.
  if (trimmed.split(/[\\/]+/).includes("..")) {
    return { ok: false, reason: "folderPath must not contain '..' segments" };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(trimmed);
  } catch {
    return { ok: false, reason: "folderPath does not exist" };
  }
  if (!stat.isDirectory()) {
    return { ok: false, reason: "folderPath is not a directory" };
  }
  return { ok: true, absolutePath: path.resolve(trimmed) };
}
