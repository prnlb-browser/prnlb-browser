import { URL } from "node:url";
import type { Page } from "playwright-core";
import type { ImageHostResolver } from "./types.js";
import { launchChromium } from "../browser.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const POLL_INTERVAL_MS = 250;
const IMAGE_WAIT_MS = 20_000;

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

  async resolve(url: string, signal?: AbortSignal): Promise<string | null> {
    try {
      if (signal?.aborted) return null;
      const pageUrl = this.buildViewPageUrl(url);
      if (!pageUrl) return null;

      const html = await this.fetchPage(pageUrl, signal);
      return this.extractBigImageUrl(html);
    } catch (err) {
      if (!signal?.aborted) {
        console.error(`FastpicResolver: Failed to resolve ${url}:`, (err as Error).message);
      }
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
      // Fastpic's thumbnail URLs commonly use .jpeg while the corresponding
      // view page is named .jpg. The live Fastpic endpoint returns 404 for the
      // .jpeg view variant, even though the thumbnail itself is valid.
      const ext = parts[0] === "thumb" ? "jpg" : extMatch[1]!;
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
   * Load the view page in Chromium and follow Fastpic's interstitial.
   *
   * Fastpic now returns a JavaScript interstitial for unsigned /big URLs.
   * The interstitial contains a generated link to the same view page with a
   * short-lived query token; only that tokenized page contains the signed
   * full-size image URL.
   */
  private async fetchPage(url: string, signal?: AbortSignal): Promise<string> {
    const browser = await launchChromium({ headless: true });
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    const onAbort = () => {
      void page.close().catch(() => {});
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      this.throwIfAborted(signal);
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      this.throwIfAborted(signal);

      const continuationUrl = await this.findContinuationUrl(page, url);
      if (continuationUrl && continuationUrl !== page.url()) {
        await page.goto(continuationUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
      }

      return await this.waitForImageHtml(page, signal);
    } finally {
      signal?.removeEventListener("abort", onAbort);
      await browser.close();
    }
  }

  private async findContinuationUrl(page: Page, baseUrl: string): Promise<string | null> {
    const hrefs = await page.locator("a[href]").evaluateAll((elements) =>
      elements
        .map((element) => element.getAttribute("href"))
        .filter((href): href is string => !!href),
    );

    for (const href of hrefs) {
      try {
        const candidate = new URL(href, baseUrl);
        const hasToken = [...candidate.searchParams.keys()].some((key) => key !== "lang");
        if (
          candidate.hostname === "fastpic.org" &&
          candidate.pathname.startsWith("/view/") &&
          hasToken
        ) {
          return candidate.toString();
        }
      } catch {
        // Ignore malformed or unrelated links from the interstitial.
      }
    }
    return null;
  }

  private async waitForImageHtml(page: Page, signal?: AbortSignal): Promise<string> {
    const deadline = Date.now() + IMAGE_WAIT_MS;
    while (Date.now() < deadline) {
      this.throwIfAborted(signal);
      const html = await page.content();
      if (this.extractBigImageUrl(html)) return html;
      await this.sleep(POLL_INTERVAL_MS, signal);
    }
    return page.content();
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      const onAbort = () => {
        clearTimeout(timer);
        cleanup();
        reject(this.abortError());
      };
      timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw this.abortError();
  }

  private abortError(): Error {
    const error = new Error("Aborted");
    error.name = "AbortError";
    return error;
  }
}
