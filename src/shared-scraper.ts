import type { Page } from "playwright-core";

// --- Helpers ---

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function resolveUrl(href: string): string {
  if (!href) return href;
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return "https:" + href;
  return `https://pornolab.net/forum/${href.replace(/^\.\//, "")}`;
}

// --- Topic detail extraction ---

export interface TopicDetails {
  postImage: string | null;
  starring: string | null;
  productionDate: string | null;
  duration: string | null;
  size: string | null;
  torrentUrl: string | null;
}

/**
 * Parse metadata from a topic detail page.
 * Expects the page to already be navigated to a topic URL.
 */
export async function parseTopicDetails(page: Page): Promise<TopicDetails> {
  // Post image — <var class="postImg" title="URL">
  const postImgSrc = await page
    .locator("var.postImg")
    .first()
    .getAttribute("title")
    .catch(() => null);

  // Metadata from post body text
  const postText = await page
    .locator(".post-user-message")
    .first()
    .innerText()
    .catch(() => "");

  const starringMatch = postText.match(/(?:В ролях|Имена актёров|Имя актрисы)[:\s]*([^\n]+)/i);
  const dateMatch = postText.match(/Дата производства[:\s]*([^\n]+)/i);
  const durationMatch = postText.match(/Продолжительность[:\s]*([^\n]+)/i);

  // Size from stats table — td.borderless.bCenter
  const statsText = await page
    .locator("td.borderless.bCenter")
    .first()
    .innerText({ timeout: 5_000 })
    .catch(() => "");
  const sizeMatch = statsText.match(/Размер[:\s]*([\d.,]+\s*[KMGT]?B)/i);

  // Torrent download link — <a class="dl-link" href="dl.php?t=...">
  const dlHref = await page
    .locator("a.dl-link")
    .first()
    .getAttribute("href", { timeout: 5_000 })
    .catch(() => null);

  return {
    postImage: postImgSrc ? resolveUrl(postImgSrc) : null,
    starring: starringMatch ? starringMatch[1]?.trim() || null : null,
    productionDate: dateMatch ? dateMatch[1]?.trim() || null : null,
    duration: durationMatch ? durationMatch[1]?.trim() || null : null,
    size: sizeMatch ? sizeMatch[1]?.trim() || null : null,
    torrentUrl: dlHref ? resolveUrl(dlHref) : null,
  };
}