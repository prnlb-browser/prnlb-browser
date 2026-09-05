import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sampleItems } from "../src/core/mcp/server.js";

describe("MCP screenshot sampling", () => {
  const items = Array.from({ length: 12 }, (_item, index) => index + 1);

  it("returns every second item using one-based positions", () => {
    assert.deepEqual(sampleItems(items, 2, 0, 50), [2, 4, 6, 8, 10, 12]);
  });

  it("returns every fifth item with an offset", () => {
    assert.deepEqual(sampleItems(items, 5, 2, 50), [7, 12]);
  });

  it("applies the result limit after sampling", () => {
    assert.deepEqual(sampleItems(items, 2, 0, 2), [2, 4]);
  });
});
