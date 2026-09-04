import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TurboImageHostResolver } from "../src/core/images/turboimagehost.js";

const PAGE_1 = "https://www.turboimagehost.com/p/127578426/1.jpg.html";
const PAGE_2 = "https://www.turboimagehost.com/p/127578428/2.jpg.html";
const IMAGE_1 = "https://s8d4.turboimg.net/sp/2de003e934452150cd9264816d70c61c/1.jpg";
const IMAGE_2 = "https://s8d4.turboimg.net/sp/6dd5c8c003f48b9950be7b8c07476418/2.jpg";

describe("TurboImageHostResolver", () => {
  const resolver = new TurboImageHostResolver();
  const extract = (html: string) =>
    (resolver as any).extractFullImageUrl(html) as string | null;

  it("recognizes TurboImageHost page URLs and resolved turboimg URLs", () => {
    assert.equal(resolver.canHandle(PAGE_1), true);
    assert.equal(resolver.canHandle(IMAGE_1), true);
    assert.equal(resolver.canHandle("https://www.turboimagehost.com/album/123/gallery"), false);
    assert.equal(resolver.canHandle("https://example.com/image.jpg"), false);
  });

  it("extracts the rendered image URL from the page DOM", () => {
    assert.equal(
      extract(`<html><body><img src="${IMAGE_1}" /></body></html>`),
      IMAGE_1,
    );
  });

  it("extracts lazy-loaded image attributes", () => {
    assert.equal(
      extract(`<html><body><img data-original="${IMAGE_2}" /></body></html>`),
      IMAGE_2,
    );
  });

  it("does not mistake unrelated turboimg paths for full-size images", () => {
    assert.equal(
      extract('<img src="https://s8d4.turboimg.net/t1/127578426/1.jpg">'),
      null,
    );
  });

  it("returns an already-resolved image URL directly", async () => {
    assert.equal(await resolver.resolve(IMAGE_1), IMAGE_1);
  });
});
