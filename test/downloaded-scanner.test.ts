import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  enrichItemsWithFileStats,
  filenameToSearchQuery,
  findVideoFiles,
  prepareImagesDirectory,
  readFileStats,
} from "../src/downloaded/scanner.js";

describe("downloaded scanner", () => {
  it("normalizes a video filename into a search query", () => {
    assert.equal(filenameToSearchQuery("Some.Movie_2026-final.mkv"), "Some Movie 2026 final");
  });

  it("finds supported videos recursively and skips hidden directories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-scanner-"));
    fs.mkdirSync(path.join(root, "nested"));
    fs.mkdirSync(path.join(root, ".hidden"));
    fs.writeFileSync(path.join(root, "movie.mp4"), "");
    fs.writeFileSync(path.join(root, "notes.txt"), "");
    fs.writeFileSync(path.join(root, "nested", "clip.MKV"), "");
    fs.writeFileSync(path.join(root, ".hidden", "private.avi"), "");

    try {
      assert.deepEqual(
        findVideoFiles(root).map((file) => path.relative(root, file)).sort(),
        ["movie.mp4", path.join("nested", "clip.MKV")].sort(),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("prepares and optionally cleans the preview directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-images-"));
    try {
      const imagesDir = prepareImagesDirectory(root);
      fs.writeFileSync(path.join(imagesDir, "preview.jpg"), "image");
      assert.equal(prepareImagesDirectory(root, true), imagesDir);
      assert.deepEqual(fs.readdirSync(imagesDir), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads OS-level stats for an existing file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-stats-"));
    const file = path.join(dir, "movie.mp4");
    fs.writeFileSync(file, "0123456789");
    try {
      const stats = readFileStats(file);
      assert.equal(stats.fileSizeBytes, 10);
      assert.ok(stats.fileMtimeMs && stats.fileMtimeMs > 0);
      assert.ok(stats.fileBirthtimeMs && stats.fileBirthtimeMs > 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns nulls when the file is missing", () => {
    const stats = readFileStats(path.join(os.tmpdir(), "definitely-does-not-exist-" + Date.now() + ".mp4"));
    assert.equal(stats.fileSizeBytes, null);
    assert.equal(stats.fileMtimeMs, null);
    assert.equal(stats.fileBirthtimeMs, null);
  });

  it("enriches items in place with file stats", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-enrich-"));
    try {
      const a = path.join(dir, "a.mp4");
      const b = path.join(dir, "b.mp4");
      fs.writeFileSync(a, "1234");
      fs.writeFileSync(b, "1234567");
      const items = [{ filePath: a }, { filePath: b }, { filePath: path.join(dir, "missing.mp4") }];
      const enriched = enrichItemsWithFileStats(items);
      assert.equal(enriched.length, 3);
      assert.equal(enriched[0]!.fileSizeBytes, 4);
      assert.equal(enriched[1]!.fileSizeBytes, 7);
      assert.equal(enriched[2]!.fileSizeBytes, null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
