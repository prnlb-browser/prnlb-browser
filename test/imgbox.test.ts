import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ImgboxResolver } from "../src/core/images/imgbox.js";

/**
 * Helper: create an ImgboxResolver with a mocked fetchPage method
 * that returns the provided HTML instead of making a real HTTP request.
 */
function createMockResolver(htmlMap: Record<string, string>): ImgboxResolver {
  const resolver = new ImgboxResolver();
  (resolver as any).fetchPage = async (url: string): Promise<string> => {
    for (const [pattern, html] of Object.entries(htmlMap)) {
      if (url.includes(pattern)) return html;
    }
    throw new Error(`No mock HTML for URL: ${url}`);
  };
  return resolver;
}

// ────────────────────────────────────────────────────────────────────────────
// URL patterns from image-links-examples.md
// ────────────────────────────────────────────────────────────────────────────

const EXAMPLE_HREF = "https://imgbox.com/nL8DBPk1";
const EXAMPLE_IMG_SRC = "https://thumbs2.imgbox.com/41/60/nL8DBPk1_t.jpg";
const EXPECTED_FULL_URL = "https://images2.imgbox.com/41/60/nL8DBPk1_o.jpg";

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("ImgboxResolver", () => {
  describe("canHandle", () => {
    const resolver = new ImgboxResolver();

    it("accepts example — link page URL (imgbox.com)", () => {
      assert.equal(resolver.canHandle(EXAMPLE_HREF), true);
    });

    it("accepts example — thumbnail URL (thumbs2.imgbox.com)", () => {
      assert.equal(resolver.canHandle(EXAMPLE_IMG_SRC), true);
    });

    it("accepts full-size image URL (images2.imgbox.com)", () => {
      assert.equal(resolver.canHandle(EXPECTED_FULL_URL), true);
    });

    it("accepts thumbs without digit (thumbs.imgbox.com)", () => {
      assert.equal(resolver.canHandle("https://thumbs.imgbox.com/ab/cd/test_t.jpg"), true);
    });

    it("rejects non-imgbox URLs", () => {
      assert.equal(resolver.canHandle("https://i127.fastpic.org/big/2026/0704/test.jpg"), false);
      assert.equal(resolver.canHandle("https://example.com/image.jpg"), false);
    });
  });

  describe("resolve — thumbnail URL (direct transform)", () => {
    const resolver = new ImgboxResolver();

    it("transforms example thumbnail to full-size", async () => {
      const result = await resolver.resolve(EXAMPLE_IMG_SRC);
      assert.equal(result, EXPECTED_FULL_URL);
    });

    it("swaps thumbs → images and _t → _o", async () => {
      const result = await resolver.resolve("https://thumbs3.imgbox.com/ab/cd/MyId_t.png");
      assert.equal(result, "https://images3.imgbox.com/ab/cd/MyId_o.png");
    });

    it("handles thumbs without digit", async () => {
      const result = await resolver.resolve("https://thumbs.imgbox.com/x/y/z_t.jpg");
      assert.equal(result, "https://images.imgbox.com/x/y/z_o.jpg");
    });
  });

  describe("resolve — link page URL (page fetch)", () => {
    it("resolves example link page via page fetch", async () => {
      const mockHtml = `<html><body>
        <div class="image-content">
          <img src="${EXPECTED_FULL_URL}" alt="image" />
        </div>
      </body></html>`;

      const resolver = createMockResolver({ [EXAMPLE_HREF]: mockHtml });
      const result = await resolver.resolve(EXAMPLE_HREF);

      assert.equal(result, EXPECTED_FULL_URL);
    });

    it("extracts image from image-content with extra attributes", async () => {
      const pageUrl = "https://imgbox.com/AbCdEf";
      const fullUrl = "https://images2.imgbox.com/12/34/AbCdEf_o.jpg";
      const mockHtml = `<div class="image-content" style="text-align:center">
        <img id="img" src="${fullUrl}" width="800" />
      </div>`;

      const resolver = createMockResolver({ [pageUrl]: mockHtml });
      const result = await resolver.resolve(pageUrl);

      assert.equal(result, fullUrl);
    });

    it("falls back to any _o suffix image when no image-content element", async () => {
      const pageUrl = "https://imgbox.com/FALLBK";
      const fullUrl = "https://images2.imgbox.com/aa/bb/FALLBK_o.jpg";
      const mockHtml = `<html><body>
        <img src="${fullUrl}" />
      </body></html>`;

      const resolver = createMockResolver({ [pageUrl]: mockHtml });
      const result = await resolver.resolve(pageUrl);

      assert.equal(result, fullUrl);
    });

    it("returns null when page has no imgbox image", async () => {
      const pageUrl = "https://imgbox.com/EMPTY1";
      const mockHtml = `<html><body><p>No images here</p></body></html>`;

      const resolver = createMockResolver({ [pageUrl]: mockHtml });
      const result = await resolver.resolve(pageUrl);

      assert.equal(result, null);
    });
  });

  describe("resolve — already full-size URL", () => {
    const resolver = new ImgboxResolver();

    it("returns full-size URL as-is", async () => {
      const result = await resolver.resolve(EXPECTED_FULL_URL);
      assert.equal(result, EXPECTED_FULL_URL);
    });

    it("returns images URL without _o suffix as-is", async () => {
      const url = "https://images5.imgbox.com/xx/yy/zz.jpg";
      const result = await resolver.resolve(url);
      assert.equal(result, url);
    });
  });
});
