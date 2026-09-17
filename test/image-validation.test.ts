import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isImageBytes } from "../src/core/images/validation.js";

describe("image byte validation", () => {
  it("accepts common raster image signatures", () => {
    assert.equal(isImageBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), true);
    assert.equal(isImageBytes(Buffer.from("GIF89a")), true);
    assert.equal(isImageBytes(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), true);
    assert.equal(isImageBytes(Buffer.from("RIFFxxxxWEBP")), true);
  });

  it("rejects Fastpic interstitial HTML", () => {
    assert.equal(isImageBytes(Buffer.from("<!doctype html><html><body>Continue to image</body></html>")), false);
  });
});

