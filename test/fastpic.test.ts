import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FastpicResolver } from "../src/resolvers/fastpic.js";

/**
 * Helper: create a FastpicResolver with a mocked fetchPage method
 * that returns the provided HTML instead of making a real HTTP request.
 */
function createMockResolver(htmlMap: Record<string, string>): FastpicResolver {
  const resolver = new FastpicResolver();
  // Override the private fetchPage method to return mocked HTML
  (resolver as any).fetchPage = async (url: string): Promise<string> => {
    // Find a matching entry in the htmlMap
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

const EXAMPLE1_HREF = "https://i127.fastpic.org/big/2026/0704/5f/_8f5089d7d56223811e37685269c0c15f.jpeg";
const EXAMPLE1_IMG_SRC = "https://i127.fastpic.org/big/2026/0704/64/cf67f964b04702d482571cbf7060c664.jpg";

const EXAMPLE2_HREF = "https://fastpic.org/view/123/2024/0613/_08a2baa39669a9d3f6463665cf2c74a4.jpg.html";
const EXAMPLE2_IMG_SRC = "https://i123.fastpic.org/thumb/2024/0613/a4/_08a2baa39669a9d3f6463665cf2c74a4.jpeg";

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("FastpicResolver", () => {
  describe("canHandle", () => {
    const resolver = new FastpicResolver();

    it("accepts example 1 — direct big image URL ending in .jpeg", () => {
      assert.equal(resolver.canHandle(EXAMPLE1_HREF), true);
    });

    it("accepts example 1 — <img src> big image URL ending in .jpg", () => {
      assert.equal(resolver.canHandle(EXAMPLE1_IMG_SRC), true);
    });

    it("accepts example 2 — view page URL ending in .html", () => {
      assert.equal(resolver.canHandle(EXAMPLE2_HREF), true);
    });

    it("accepts example 2 — <img src> thumbnail URL ending in .jpeg", () => {
      assert.equal(resolver.canHandle(EXAMPLE2_IMG_SRC), true);
    });

    it("rejects non-fastpic URLs", () => {
      assert.equal(resolver.canHandle("https://imgbox.com/abc123"), false);
      assert.equal(resolver.canHandle("https://example.com/image.jpg"), false);
    });

    it("rejects fastpic URLs without image extension or view path", () => {
      assert.equal(resolver.canHandle("https://fastpic.org/about"), false);
      assert.equal(resolver.canHandle("https://i127.fastpic.org/big/2026/"), false);
    });
  });

  describe("buildViewPageUrl", () => {
    const resolver = new FastpicResolver();
    const build = (url: string) => (resolver as any).buildViewPageUrl(url) as string | null;

    it("builds view page URL from example 1 — direct big image with hash segment", () => {
      const result = build(EXAMPLE1_HREF);
      assert.equal(result, "https://fastpic.org/view/127/2026/0704/_8f5089d7d56223811e37685269c0c15f.jpg.html");
    });

    it("builds view page URL from example 2 — thumbnail with hash segment", () => {
      const result = build(EXAMPLE2_IMG_SRC);
      assert.equal(result, "https://fastpic.org/view/123/2024/0613/_08a2baa39669a9d3f6463665cf2c74a4.jpg.html");
    });

    it("builds view page URL from a thumb URL without hash segment", () => {
      const url = "https://i5.fastpic.org/thumb/2023/1001/abcdef1234567890abcdef1234567890.jpeg";
      const result = build(url);
      assert.equal(result, "https://fastpic.org/view/5/2023/1001/abcdef1234567890abcdef1234567890.jpg.html");
    });

    it("returns null for invalid hostname", () => {
      assert.equal(build("https://example.com/big/2026/0704/5f/test.jpg"), null);
    });

    it("returns null for path with too few segments", () => {
      assert.equal(build("https://i127.fastpic.org/big/2026"), null);
    });
  });

  describe("extractBigImageUrl", () => {
    const resolver = new FastpicResolver();
    const extract = (html: string) => (resolver as any).extractBigImageUrl(html) as string | null;

    it("extracts big image URL with ?md5 and ?expires from <img> tag", () => {
      const html = `
        <html><body>
          <img src="https://i127.fastpic.org/big/2026/0704/5f/_8f5089d7d56223811e37685269c0c15f.jpg?md5=abc123&expires=1720000000" />
        </body></html>
      `;
      const result = extract(html);
      assert.equal(result, "https://i127.fastpic.org/big/2026/0704/5f/_8f5089d7d56223811e37685269c0c15f.jpg?md5=abc123&expires=1720000000");
    });

    it("extracts big image URL from <img> tag with single quotes", () => {
      const html = `
        <img src='https://i127.fastpic.org/big/2026/0704/64/cf67f964b04702d482571cbf7060c664.jpg?md5=def456&amp;expires=1720000001' />
      `;
      const result = extract(html);
      assert.equal(result, "https://i127.fastpic.org/big/2026/0704/64/cf67f964b04702d482571cbf7060c664.jpg?md5=def456&expires=1720000001");
    });

    it("extracts big image URL from href attribute when no <img> match", () => {
      const html = `
        <a href="https://i5.fastpic.org/big/2023/1001/abc/test.png?md5=xyz&expires=999">
          click here
        </a>
      `;
      const result = extract(html);
      assert.equal(result, "https://i5.fastpic.org/big/2023/1001/abc/test.png?md5=xyz&expires=999");
    });

    it("returns null when no big image URL is found", () => {
      const html = `<html><body><p>No images here</p></body></html>`;
      assert.equal(extract(html), null);
    });

    it("handles HTML with multiline attributes", () => {
      const html = `<img
        src="https://i127.fastpic.org/big/2026/0704/5f/hash.jpg?md5=abc&expires=123"
        alt="pic"
      />`;
      const result = extract(html);
      assert.equal(result, "https://i127.fastpic.org/big/2026/0704/5f/hash.jpg?md5=abc&expires=123");
    });
  });

  describe("resolve", () => {
    it("resolves example 1 — direct big image URL via page fetch", async () => {
      const viewPageUrl = "https://fastpic.org/view/127/2026/0704/_8f5089d7d56223811e37685269c0c15f.jpg.html";
      const bigImageUrl = "https://i127.fastpic.org/big/2026/0704/5f/_8f5089d7d56223811e37685269c0c15f.jpg?md5=abc123&expires=1720000000";

      const mockHtml = `<html><body>
        <img src="${bigImageUrl}" />
      </body></html>`;

      const resolver = createMockResolver({ [viewPageUrl]: mockHtml });
      const result = await resolver.resolve(EXAMPLE1_HREF);

      assert.equal(result, bigImageUrl);
    });

    it("resolves example 2 — view page URL directly", async () => {
      const bigImageUrl = "https://i123.fastpic.org/big/2024/0613/a4/_08a2baa39669a9d3f6463665cf2c74a4.jpg?md5=def456&expires=1720000001";

      const mockHtml = `<html><body>
        <img src="${bigImageUrl}" />
      </body></html>`;

      const resolver = createMockResolver({ [EXAMPLE2_HREF]: mockHtml });
      const result = await resolver.resolve(EXAMPLE2_HREF);

      assert.equal(result, bigImageUrl);
    });

    it("resolves example 2 — thumbnail URL builds view page and fetches", async () => {
      const viewPageUrl = "https://fastpic.org/view/123/2024/0613/_08a2baa39669a9d3f6463665cf2c74a4.jpg.html";
      const bigImageUrl = "https://i123.fastpic.org/big/2024/0613/a4/_08a2baa39669a9d3f6463665cf2c74a4.jpg?md5=ghi789&expires=1720000002";

      const mockHtml = `<html><body>
        <img src="${bigImageUrl}" />
      </body></html>`;

      const resolver = createMockResolver({ [viewPageUrl]: mockHtml });
      const result = await resolver.resolve(EXAMPLE2_IMG_SRC);

      assert.equal(result, bigImageUrl);
    });

    it("always loads the page — even for URLs ending in .jpeg", async () => {
      // Simulate a direct .jpeg URL that must be resolved via page fetch
      const directJpegUrl = "https://i99.fastpic.org/big/2025/0101/ab/direct_image.jpeg";
      const viewPageUrl = "https://fastpic.org/view/99/2025/0101/direct_image.jpg.html";
      const resolvedUrl = "https://i99.fastpic.org/big/2025/0101/ab/direct_image.jpg?md5=test&expires=9999";

      const mockHtml = `<html><body>
        <a href="${resolvedUrl}"><img src="${resolvedUrl}" /></a>
      </body></html>`;

      const resolver = createMockResolver({ [viewPageUrl]: mockHtml });
      const result = await resolver.resolve(directJpegUrl);

      assert.equal(result, resolvedUrl);
    });

    it("decodes HTML entities in extracted URLs", async () => {
      const viewPageUrl = "https://fastpic.org/view/10/2025/0101/test.jpg.html";
      const bigImageUrl = "https://i10.fastpic.org/big/2025/0101/ab/test.jpg?md5=a&amp;b&expires=123";

      const mockHtml = `<html><body>
        <img src="${bigImageUrl}" />
      </body></html>`;

      const resolver = createMockResolver({ [viewPageUrl]: mockHtml });
      const result = await resolver.resolve(viewPageUrl);

      assert.equal(result, "https://i10.fastpic.org/big/2025/0101/ab/test.jpg?md5=a&b&expires=123");
    });

    it("returns null when view page has no big image", async () => {
      const viewPageUrl = "https://fastpic.org/view/10/2025/0101/missing.jpg.html";
      const mockHtml = `<html><body><p>No image found</p></body></html>`;

      const resolver = createMockResolver({ [viewPageUrl]: mockHtml });
      const result = await resolver.resolve(viewPageUrl);

      assert.equal(result, null);
    });

    it("returns null for unparseable URLs", async () => {
      const resolver = new FastpicResolver();
      const result = await resolver.resolve("not-a-valid-url");
      assert.equal(result, null);
    });
  });
});
