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
        parsed.pathname.includes("/thumb/")
      );
    } catch {
      return false;
    }
  }

  async resolve(thumbUrl: string): Promise<string | null> {
    try {
      const viewPageUrl = this.buildViewPageUrl(thumbUrl);
      if (!viewPageUrl) return null;

      const html = await this.fetchPage(viewPageUrl);

      // Look for the full-size image URL in the HTML.
      // The big image URL pattern on fastpic is:
      //   https://i<id>.fastpic.org/big/...jpg?md5=...&expires=...
      // It appears in <img> tags or <a> tags.
      const bigUrl = this.extractBigImageUrl(html);
      return bigUrl;
    } catch (err) {
      console.error(`FastpicResolver: Failed to resolve ${thumbUrl}:`, (err as Error).message);
      return null;
    }
  }

  /**
   * Build the view page URL from a thumbnail URL.
   *
   * Example:
   *   Thumb: https://i122.fastpic.org/thumb/2023/1001/9d/387ccd6fe21d83ff5f740e7a9b11239d.jpeg
   *   View:  https://fastpic.org/view/122/2023/1001/387ccd6fe21d83ff5f740e7a9b11239d.jpg.html
   */
  private buildViewPageUrl(thumbUrl: string): string | null {
    try {
      const parsed = new URL(thumbUrl);
      const hostname = parsed.hostname; // e.g. "i127.fastpic.org"
      const hostMatch = hostname.match(/^i(\d+)\.fastpic\.org$/i);
      if (!hostMatch) return null;
      const numericId = hostMatch[1]!; // e.g. "127"

      const parts = parsed.pathname.split("/").filter(Boolean);
      // parts: ["thumb", "2026", "0630", "1a", "filename.jpeg"] — 5 parts
      // or:    ["thumb", "2026", "0630", "filename.jpeg"] — 4 parts (no hash segment)

      if (parts.length < 4 || parts[0] !== "thumb") return null;

      const year = parts[1]!;
      const monthDay = parts[2]!;

      // Filename is always the last part
      const fileName = parts[parts.length - 1]!;
      // Remove extension, then re-add .jpg for the view page
      const baseName = fileName.replace(/\.[^.]+$/, "");
      const viewFileName = `${baseName}.jpg`;

      return `https://fastpic.org/view/${numericId}/${year}/${monthDay}/${viewFileName}.html`;
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
   * Fetch a page's HTML content.
   */
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
          },
          timeout: 15_000,
        },
        (res) => {
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
