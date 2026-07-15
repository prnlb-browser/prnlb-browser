import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { validateFolderPath } from "../src/core/fs-paths.js";

describe("validateFolderPath", () => {
  it("rejects empty / non-string / non-absolute paths", () => {
    assert.equal(validateFolderPath("").ok, false);
    assert.equal(validateFolderPath("   ").ok, false);
    assert.equal(validateFolderPath(undefined as unknown as string).ok, false);
    assert.equal(validateFolderPath(null as unknown as string).ok, false);
    assert.equal(validateFolderPath("relative/path").ok, false);
  });

  it("rejects paths with '..' segments even if the rest is absolute", () => {
    assert.equal(validateFolderPath("/tmp/../etc").ok, false);
    assert.equal(validateFolderPath("/tmp/../etc/passwd").ok, false);
  });

  it("rejects paths that do not exist", () => {
    const missing = path.join(os.tmpdir(), `prnlb-does-not-exist-${Date.now()}`);
    const result = validateFolderPath(missing);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /does not exist/);
  });

  it("rejects paths that exist but are not directories", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-folder-"));
    const file = path.join(dir, "file.txt");
    fs.writeFileSync(file, "x");
    try {
      const result = validateFolderPath(file);
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.reason, /not a directory/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts an existing absolute directory and resolves it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-folder-"));
    try {
      const result = validateFolderPath(dir);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.absolutePath, path.resolve(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
