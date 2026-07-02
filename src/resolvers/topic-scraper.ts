import type { Page } from "playwright-core";
import type { ImageProgress } from "./types.js";
import { launchChromium } from "../browser.js";

export type ProgressFn = (p: ImageProgress) => void;

/**
 * Navigate to a topic page and extract all image URLs from the first post
 * that match known image host patterns.
 */
export async function scrapeTopicImages(
  topicUrl: string,
  onProgress?: ProgressFn,
): Promise<string[]> {
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
    const imageUrls = await extractImagesFromFirstPost(page);

    emit({ phase: "scraping", message: `Found ${imageUrls.length} image(s)` });
    return imageUrls;
  } finally {
    await browser.close();
  }
}

async function extractImagesFromFirstPost(page: Page): Promise<string[]> {
  const urls: string[] = [];

  // Method 1: Look for <var class="postImg" title="URL"> elements
  // Pornolab renders BBCode [img] tags as <var class="postImg" title="URL">
  const postImgUrls = await page
    .locator("var.postImg")
    .evaluateAll((elements) =>
      elements.map((el) => el.getAttribute("title")).filter(Boolean),
    );
  urls.push(...(postImgUrls as string[]));

  // Method 2: Look for direct <img> tags inside the first post message
  const imgSrcs = await page
    .locator(".post-user-message img")
    .evaluateAll((elements) =>
      elements.map((el) => el.getAttribute("src")).filter(Boolean),
    );
  urls.push(...(imgSrcs as string[]));

  // Method 3: Look for <a> tags with images inside the first post
  const linkImgs = await page
    .locator(".post-user-message a img")
    .evaluateAll((elements) =>
      elements.map((el) => el.getAttribute("src")).filter(Boolean),
    );
  urls.push(...(linkImgs as string[]));

  // Method 4: Look for raw fastpic.org URLs in the post body text
  // Pornolab sometimes shows images as clickable text links rather than embedded.
  // Exclude links that wrap a <var class="postImg"> — those thumbnails are already
  // captured by Method 1, and including them would double-count images.
  const fastpicLinks = await page
    .locator(".post-user-message a[href*='fastpic.org']")
    .evaluateAll((elements) =>
      elements
        .filter((el) => !el.querySelector("var.postImg"))
        .map((el) => el.getAttribute("href"))
        .filter(Boolean),
    );
  urls.push(...(fastpicLinks as string[]));

  // Resolve relative URLs
  return urls
    .map((url) => (url.startsWith("http") ? url : `https://pornolab.net/forum/${url.replace(/^\.\//, "")}`))
    .filter((url, index, self) => self.indexOf(url) === index); // deduplicate
}