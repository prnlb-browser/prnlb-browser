import * as https from "node:https";
import * as http from "node:http";
import { URL } from "node:url";
import type { ImageHostResolver } from "./types.js";

/**
 * Resolver for images hosted on imgbox.com.
 *
 * Handles two URL patterns:
 *
 * 1. Thumbnail URLs (found in topic posts):
 *    https://thumbs2.imgbox.com/b4/65/Cc8cHwpS_t.jpg
 *    → Transformed directly to:
 *    https://images2.imgbox.com/b4/65/Cc8cHwpS_o.jpg
 *
 * 2. Link page URLs:
 *    https://imgbox.com/Cc8cHwpS
 *    → Fetched and full-size image extracted from HTML.
 */
export class ImgboxResolver implements ImageHostResolver {
  name = "imgbox";

  canHandle(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname.endsWith(".imgbox.com") ||
        parsed.hostname === "imgbox.com"
      );
    } catch {
      return false;
    }
  }

  async resolve(url: string): Promise<string | null> {
    try {
      const parsed = new URL(url);

      // Case 1: Thumbnail URL (e.g. https://thumbs2.imgbox.com/b4/65/Cc8cHwpS_t.jpg)
      if (parsed.hostname.match(/^thumbs\d*\.imgbox\.com$/i)) {
        return this.resolveThumbnail(url);
      }

      // Case 2: Link page URL (e.g. https://imgbox.com/Cc8cHwpS)
      if (parsed.hostname === "imgbox.com") {
        return await this.resolveFromPage(url);
      }

      // Already a full-size image URL (e.g. images2.imgbox.com) — return as-is
      if (parsed.hostname.match(/^images\d*\.imgbox\.com$/i)) {
        return url;
      }

      return null;
    } catch (err) {
      console.error(`ImgboxResolver: Failed to resolve ${url}:`, (err as Error).message);
      return null;
    }
  }

  /**
   * Transform a thumbnail URL to full-size by swapping subdomain and suffix.
   *
   * Example:
   *   https://thumbs2.imgbox.com/b4/65/Cc8cHwpS_t.jpg
   *   → https://images2.imgbox.com/b4/65/Cc8cHwpS_o.jpg
   */
  private resolveThumbnail(thumbUrl: string): string {
    const parsed = new URL(thumbUrl);
    // Replace "thumbs" with "images" in the hostname
    const fullHost = parsed.hostname.replace(/^thumbs/, "images");
    parsed.hostname = fullHost;
    // Replace _t. with _o. in the pathname (thumbnail → original)
    parsed.pathname = parsed.pathname.replace(/_t\./i, "_o.");
    return parsed.toString();
  }

  /**
   * Fetch the imgbox link page and extract the full-size image URL
   * from the element with class="image-content".
   */
  private async resolveFromPage(pageUrl: string): Promise<string | null> {
    const html = await this.fetchPage(pageUrl);
    if (!html) return null;

    // Look for <img> inside an element with class="image-content"
    // The image src typically looks like https://images2.imgbox.com/b4/65/Cc8cHwpS_o.jpg
    const normalizedHtml = html.replace(/\s+/g, " ");

    // Pattern: <img ... src="..." ...> inside image-content
    const imageContentRegex = /class="image-content"[^>]*>.*?<img[^>]+src=["'](https:\/\/images\d*\.imgbox\.com\/[^"']+)["']/is;
    const match = normalizedHtml.match(imageContentRegex);
    if (match) {
      return match[1]!;
    }

    // Fallback: look for any imgbox image URL with _o suffix (original size)
    const fallbackRegex = /src=["'](https:\/\/images\d*\.imgbox\.com\/[^"']*_o\.[^"']+)["']/i;
    const fallbackMatch = normalizedHtml.match(fallbackRegex);
    if (fallbackMatch) {
      return fallbackMatch[1]!;
    }

    console.error(`ImgboxResolver: Could not extract full-size image from ${pageUrl}`);
    return null;
  }

  private fetchPage(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === "https:" ? https : http;

      const req = client.get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        },
        (res) => {
          // Follow redirects
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            this.fetchPage(res.headers.location).then(resolve).catch(reject);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            return;
          }

          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
          res.on("error", reject);
        },
      );

      req.on("error", reject);
      req.setTimeout(15_000, () => {
        req.destroy();
        reject(new Error(`Timeout fetching ${url}`));
      });
    });
  }
}
