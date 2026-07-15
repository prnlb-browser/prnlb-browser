import type { Page } from "playwright-core";
import type { ImageProgress, ScrapedImage } from "./types.js";
import { launchChromium } from "../browser.js";
import { resolverRegistry } from "./registry.js";

export type ProgressFn = (p: ImageProgress) => void;

/**
 * Navigate to a topic page and extract all image URLs from the first post
 * that match known image host patterns.
 * Returns ScrapedImage objects with separate thumbnail and resolve URLs.
 */
export async function scrapeTopicImages(
  topicUrl: string,
  onProgress?: ProgressFn,
): Promise<ScrapedImage[]> {
  const emit = (p: ImageProgress) => { if (onProgress) onProgress(p); };
  const browser = await launchChromium({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    // Navigate to topic page directly — topic pages are publicly accessible
    emit({ phase: "scraping", message: "Loading topic page..." });
    await page.goto(topicUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000);

    // Extract all image URLs from the first post's message area
    emit({ phase: "scraping", message: "Extracting images from post..." });
    const images = await extractImagesFromFirstPost(page);

    emit({ phase: "scraping", message: `Found ${images.length} image(s)` });
    return images;
  } finally {
    await browser.close();
  }
}

async function extractImagesFromFirstPost(page: Page): Promise<ScrapedImage[]> {
  const images: ScrapedImage[] = [];

  // Method 1: Look for <var class="postImg" title="URL"> elements
  // Pornolab renders BBCode [img] tags as <var class="postImg" title="URL">
  // When wrapped in an <a> tag:
  //   - Use <img src> as the carousel thumbnail
  //   - Use <a href> as the URL to resolve
  // This handles patterns like:
  //   <a href="https://fastpic.org/view/...html">
  //     <var class="postImg" title="https://i123.fastpic.org/thumb/...jpeg">
  //       <img src="https://i123.fastpic.org/thumb/...jpeg">
  //     </var>
  //   </a>
  const postImgEntries = await page
    .locator("var.postImg")
    .evaluateAll((elements) =>
      elements.map((el) => {
        const imgEl = el.querySelector("img");
        const imgSrc = imgEl ? imgEl.getAttribute("src") : null;
        const titleSrc = el.getAttribute("title");
        const thumbnail = (imgSrc || titleSrc || "");

        const parentLink = el.closest("a");
        if (parentLink) {
          const href = parentLink.getAttribute("href");
          if (href && href.startsWith("http")) {
            return { thumbnailUrl: thumbnail, resolveUrl: href };
          }
        }
        // No parent link — use thumbnail URL as the resolve URL too
        return { thumbnailUrl: thumbnail, resolveUrl: thumbnail };
      }).filter((entry) => entry.thumbnailUrl && entry.resolveUrl),
    );
  images.push(...(postImgEntries as ScrapedImage[]));

  // Method 2: Look for direct <img> tags inside the first post message
  // Skip <img> elements inside <var class="postImg"> — those are already handled by Method 1
  const imgSrcs = await page
    .locator(".post-user-message img")
    .evaluateAll((elements) =>
      elements
        .filter((el) => !el.closest("var.postImg"))
        .map((el) => el.getAttribute("src"))
        .filter(Boolean),
    );
  for (const url of imgSrcs as string[]) {
    images.push({ thumbnailUrl: url, resolveUrl: url });
  }

  // Method 3: Look for <a> tags with images inside the first post
  // Skip <img> elements inside <var class="postImg"> — those are already handled by Method 1
  const linkImgs = await page
    .locator(".post-user-message a img")
    .evaluateAll((elements) =>
      elements
        .filter((el) => !el.closest("var.postImg"))
        .map((el) => el.getAttribute("src"))
        .filter(Boolean),
    );
  for (const url of linkImgs as string[]) {
    images.push({ thumbnailUrl: url, resolveUrl: url });
  }

  // Method 4: Look for <a> tags that point to known image hosts.
  // Pornolab sometimes shows images as clickable text links rather than embedded.
  // Exclude links that wrap a <var class="postImg"> — those are already
  // captured by Method 1, and including them would double-count images.
  const allLinks = await page
    .locator(".post-user-message a[href]")
    .evaluateAll((elements) =>
      elements
        .filter((el) => !el.querySelector("var.postImg"))
        .map((el) => el.getAttribute("href"))
        .filter(Boolean),
    );
  const imageHostLinks = (allLinks as string[]).filter(
    (url) => url.startsWith("http") && resolverRegistry.findResolver(url),
  );
  for (const url of imageHostLinks) {
    images.push({ thumbnailUrl: url, resolveUrl: url });
  }

  // Resolve relative URLs and deduplicate by resolveUrl
  const seen = new Set<string>();
  const resolved: ScrapedImage[] = [];
  for (const img of images) {
    const resolveUrl = img.resolveUrl.startsWith("http")
      ? img.resolveUrl
      : `https://pornolab.net/forum/${img.resolveUrl.replace(/^\.\//, "")}`;
    const thumbnailUrl = img.thumbnailUrl.startsWith("http")
      ? img.thumbnailUrl
      : `https://pornolab.net/forum/${img.thumbnailUrl.replace(/^\.\//, "")}`;
    if (seen.has(resolveUrl)) continue;
    seen.add(resolveUrl);
    resolved.push({ thumbnailUrl, resolveUrl });
  }
  return resolved;
}