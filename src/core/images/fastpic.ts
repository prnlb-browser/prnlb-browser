import * as https from "node:https";
import * as http from "node:http";
import { URL } from "node:url";
import type { ImageHostResolver } from "./types.js";

/**
 * Resolver for images hosted on fastpic.org.
 *
 * Handles URLs like:
 *   https://i122.fastpic.org/thumb/2023/1001/9d/387ccd6fe21d83ff5f740e7a9b11239d.jpeg
 *
 * Resolution process:
 * 1. Parse the thumbnail URL to construct the view page URL
 * 2. Fetch the HTML of the view page
 * 3. Extract the full-size image URL from the HTML
 */
export class FastpicResolver implements ImageHostResolver {
  name = "fastpic";

  canHandle(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname.endsWith(".fastpic.org") &&
        /\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(parsed.pathname)
      ) || (
        parsed.hostname === "fastpic.org" &&
        parsed.pathname.includes("/view/")
      );
    } catch {
      return false;
    }
  }

  async resolve(url: string): Promise<string | null> {
    try {
      const pageUrl = this.buildViewPageUrl(url);
      if (!pageUrl) return null;

      const html = await this.fetchPage(pageUrl);
      return this.extractBigImageUrl(html);
    } catch (err) {
      console.error(`FastpicResolver: Failed to resolve ${url}:`, (err as Error).message);
      return null;
    }
  }

  /**
   * Convert a Fastpic thumbnail or direct image URL to its public view page.
   * View-page URLs are already suitable and are returned unchanged.
   */
  private buildViewPageUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === "fastpic.org" && parsed.pathname.startsWith("/view/")) {
        return parsed.toString();
      }

      const hostMatch = parsed.hostname.match(/^i(\d+)\.fastpic\.org$/i);
      if (!hostMatch) return null;

      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length < 4 || !["big", "thumb"].includes(parts[0]!)) return null;

      const year = parts[1]!;
      const date = parts[2]!;
      const fileName = parts.at(-1)!;
      const extMatch = fileName.match(/\.(jpe?g|png|gif|webp|bmp)$/i);
      if (!extMatch) return null;
      const ext = extMatch[1]!;
      const stem = fileName.slice(0, -extMatch[0].length);
      if (!year || !date || !stem) return null;

      // The view page's md5 token is signed for the requested extension —
      // fastpic serves .jpeg and .jpg from the same stem as distinct files,
      // so a mismatched extension here produces a token whose big-image
      // URL 404s. Preserve the original extension rather than assuming .jpg.
      return `https://fastpic.org/view/${hostMatch[1]}/${year}/${date}/${stem}.${ext}.html`;
    } catch {
      return null;
    }
  }

  /**
   * Extract the big image URL from the fastpic view page HTML.
   * Looks for URLs matching the fastpic big image pattern.
   */
  private extractBigImageUrl(html: string): string | null {
    // Normalize whitespace in HTML — the src attribute may span multiple lines
    const normalizedHtml = html.replace(/\s+/g, " ");

    // Pattern 1: Look for <img> tags with big image URLs
    const imgRegex = /<img[^>]+src=["'](https:\/\/i\d+\.fastpic\.org\/big\/[^"']+)["']/i;
    const imgMatch = normalizedHtml.match(imgRegex);
    if (imgMatch) {
      return this.decodeHtmlEntities(imgMatch[1]!);
    }

    // Pattern 2: Look for direct URL references to big images in any attribute
    const urlRegex = /(https:\/\/i\d+\.fastpic\.org\/big\/[^\s<>"']+)/i;
    const urlMatch = normalizedHtml.match(urlRegex);
    if (urlMatch) {
      return this.decodeHtmlEntities(urlMatch[1]!);
    }

    return null;
  }

  private decodeHtmlEntities(str: string): string {
    return str.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  }

  /**
   * Fetch a page's HTML content, following redirects (302, 301, etc.).
   */
  private fetchPage(url: string, maxRedirects = 5): Promise<string> {
    return new Promise((resolve, reject) => {
      if (maxRedirects <= 0) {
        reject(new Error("Too many redirects"));
        return;
      }

      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === "https:" ? https : http;

      const req = client.get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
          timeout: 15_000,
        },
        (res) => {
          // Follow redirects
          const statusCode = res.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, url).toString();
            res.resume(); // drain the response body
            this.fetchPage(redirectUrl, maxRedirects - 1).then(resolve, reject);
            return;
          }

          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const html = Buffer.concat(chunks).toString("utf-8");
            resolve(html);
          });
        },
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });
    });
  }
}
