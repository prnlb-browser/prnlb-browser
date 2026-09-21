import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PicshickResolver } from "../src/core/images/picshick.js";

const PAGE_URL =
  "https://picshick.com/d5kznu9g3d4t/OnlyFans_-_Siri_Dahl__Dredd_-_Round_2_Full_Romp_1080p_rq.mp4_thumbs.jpg";
const THUMB_URL = "https://img400.picshick.com/th/76325/d5kznu9g3d4t.jpg";
const FULL_URL = "https://img400.picshick.com/i/76325/d5kznu9g3d4t.jpg";

function createMockResolver(html: string): PicshickResolver {
  const resolver = new PicshickResolver();
  (resolver as any).fetchPage = async (): Promise<string> => html;
  return resolver;
}

describe("PicshickResolver", () => {
  it("recognizes Picshick page and image URLs", () => {
    const resolver = new PicshickResolver();
    assert.equal(resolver.canHandle(PAGE_URL), true);
    assert.equal(resolver.canHandle(THUMB_URL), true);
    assert.equal(resolver.canHandle(FULL_URL), true);
    assert.equal(resolver.canHandle("https://example.com/image.jpg"), false);
  });

  it("converts a thumbnail URL to the original image endpoint", async () => {
    assert.equal(await new PicshickResolver().resolve(THUMB_URL), FULL_URL);
  });

  it("extracts the original image URL from a Picshick page", async () => {
    const resolver = createMockResolver(`<img src="${FULL_URL}/file.jpg" />`);
    assert.equal(await resolver.resolve(PAGE_URL), `${FULL_URL}/file.jpg`);
  });
});
