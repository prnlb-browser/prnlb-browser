import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";
import type { ImageHostResolver } from "./types.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Resolver for Picshick/ImageTwist image pages and thumbnails. */
export class PicshickResolver implements ImageHostResolver {
  name = "picshick";

  canHandle(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        ((parsed.hostname === "picshick.com" ||
          parsed.hostname === "www.picshick.com") &&
          /^\/[^/]+\/[^/]+$/i.test(parsed.pathname)) ||
        (/^img\d+\.picshick\.com$/i.test(parsed.hostname) &&
          /^\/(?:th|i)\//i.test(parsed.pathname))
      );
    } catch {
      return false;
    }
  }

  async resolve(url: string): Promise<string | null> {
    try {
      const parsed = new URL(url);
      if (/^img\d+\.picshick\.com$/i.test(parsed.hostname)) {
        if (/^\/i\//i.test(parsed.pathname)) return parsed.toString();
        return this.thumbnailToImageUrl(parsed);
      }

      const html = await this.fetchPage(url);
      return this.extractFullImageUrl(html);
    } catch (err) {
      console.error(
        `PicshickResolver: Failed to resolve ${url}:`,
        (err as Error).message,
      );
      return null;
    }
  }

  private thumbnailToImageUrl(url: URL): string | null {
    const match = url.pathname.match(/^\/th\/([^/]+)\/([^/]+)$/i);
    if (!match) return null;
    url.pathname = `/i/${match[1]}/${match[2]}`;
    return url.toString();
  }

  private extractFullImageUrl(html: string): string | null {
    const normalizedHtml = html.replace(/\s+/g, " ");
    const match = normalizedHtml.match(
      /(?:src|href)\s*=\s*["'](https:\/\/img\d+\.picshick\.com\/i\/[^"']+)["']/i,
    );
    return match?.[1]?.replace(/&amp;/g, "&") ?? null;
  }

  private fetchPage(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === "https:" ? https : http;
      const req = client.get(
        url,
        { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" } },
        (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            const redirectedUrl = new URL(res.headers.location, url).toString();
            this.fetchPage(redirectedUrl).then(resolve).catch(reject);
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
