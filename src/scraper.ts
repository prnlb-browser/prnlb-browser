import type { Browser, Page } from "playwright-core";
import type { Config, TopicData, CrawlProgress } from "./types.js";
import { launchChromium } from "./browser.js";

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function resolveUrl(href: string): string {
  return href.startsWith("http")
    ? href
    : `https://pornolab.net/forum/${href.replace(/^\.\//, "")}`;
}

// --- Internal steps ---

async function login(
  page: Page,
  config: Config,
  onProgress: (p: CrawlProgress) => void,
): Promise<void> {
  onProgress({ phase: "login", message: "Opening login page..." });
  await page.goto("https://pornolab.net/forum/login.php", {
    waitUntil: "domcontentloaded",
  });
  await sleep(1000);

  onProgress({ phase: "login", message: "Filling credentials..." });
  await page
    .locator('form[action="login.php"] input[name="login_username"]')
    .fill(config.credentials.username);
  await page
    .locator('form[action="login.php"] input[name="login_password"]')
    .fill(config.credentials.password);

  await Promise.all([
    page.waitForURL("**/index.php", { timeout: 15_000 }).catch(() => {}),
    page
      .locator('form[action="login.php"] input[name="login"]')
      .click(),
  ]);
  await sleep(2000);

  const loggedIn = page.locator(
    `a:has-text("${config.credentials.username}")`,
  );
  if ((await loggedIn.count()) === 0) {
    throw new Error("Login failed — username not found on page after login");
  }
  onProgress({ phase: "login", message: "Login successful!" });
}

async function collectTopicUrls(
  page: Page,
  config: Config,
  onProgress: (p: CrawlProgress) => void,
): Promise<{ title: string; url: string; sourceForum: string }[]> {
  const seenUrls = new Set<string>();
  const topics: { title: string; url: string; sourceForum: string }[] = [];
  const delay = config.delay ?? { min: 1500, max: 4000 };

  for (const forum of config.forums) {
    for (let pageNum = 0; pageNum < config.pagesToScan; pageNum++) {
      const pageUrl =
        pageNum === 0
          ? forum.url
          : forum.url.includes("?")
            ? `${forum.url}&start=${pageNum * 50}`
            : `${forum.url}?start=${pageNum * 50}`;

      onProgress({
        phase: "listing",
        message: `Forum: ${forum.label} — page ${pageNum + 1}/${config.pagesToScan}`,
        current: pageNum + 1,
        total: config.pagesToScan,
      });

      await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
      await sleep(randomDelay(delay.min, delay.max));

      const topicLinks = await page.locator("a.torTopic").all();
      for (const link of topicLinks) {
        const href = await link.getAttribute("href");
        if (!href) continue;
        const fullUrl = resolveUrl(href);
        if (seenUrls.has(fullUrl)) continue;
        seenUrls.add(fullUrl);
        const title = (await link.textContent())?.trim() || "";
        topics.push({ title, url: fullUrl, sourceForum: forum.label });
      }
    }
  }
  return topics;
}

async function extractTopicDetails(
  page: Page,
  topics: { title: string; url: string; sourceForum: string }[],
  existingUrls: Set<string>,
  config: Config,
  onProgress: (p: CrawlProgress) => void,
): Promise<{ results: TopicData[]; skipped: number }> {
  const results: TopicData[] = [];
  let skipped = 0;
  const delay = config.delay ?? { min: 1500, max: 4000 };

  for (let i = 0; i < topics.length; i++) {
    const topicRef = topics[i]!;

    if (existingUrls.has(topicRef.url)) {
      onProgress({
        phase: "detail",
        message: `SKIP (exists): ${topicRef.title}`,
        current: i + 1,
        total: topics.length,
      });
      skipped++;
      continue;
    }
    onProgress({
      phase: "detail",
      message: topicRef.title,
      current: i + 1,
      total: topics.length,
    });

    const entry: TopicData = {
      title: topicRef.title,
      postImage: null,
      starring: null,
      productionDate: null,
      duration: null,
      size: null,
      torrentUrl: null,
      topicUrl: topicRef.url,
      sourceForum: topicRef.sourceForum,
      hidden: 0,
    };

    try {
      await page.goto(topicRef.url, { waitUntil: "domcontentloaded" });
      await sleep(randomDelay(delay.min, delay.max));

      // Post image — <var class="postImg" title="URL">
      const postImgSrc = await page
        .locator("var.postImg")
        .first()
        .getAttribute("title")
        .catch(() => null);
      if (postImgSrc) entry.postImage = resolveUrl(postImgSrc);

      // Metadata from post body text
      const postText = await page
        .locator(".post-user-message")
        .first()
        .innerText()
        .catch(() => "");

      const starringMatch = postText.match(/В ролях[:\s]*([^\n]+)/i);
      if (starringMatch) entry.starring = starringMatch[1]?.trim() || null;

      const dateMatch = postText.match(/Дата производства[:\s]*([^\n]+)/i);
      if (dateMatch) entry.productionDate = dateMatch[1]?.trim() || null;

      const durationMatch = postText.match(/Продолжительность[:\s]*([^\n]+)/i);
      if (durationMatch) entry.duration = durationMatch[1]?.trim() || null;

      // Size from stats table — td.borderless.bCenter
      const statsText = await page
        .locator("td.borderless.bCenter")
        .first()
        .innerText({ timeout: 5_000 })
        .catch(() => "");
      const sizeMatch = statsText.match(/Размер[:\s]*([\d.,]+\s*[KMGT]?B)/i);
      if (sizeMatch) entry.size = sizeMatch[1]?.trim() || null;

      // Torrent download link — <a class="dl-link" href="dl.php?t=...">
      const dlHref = await page
        .locator("a.dl-link")
        .first()
        .getAttribute("href", { timeout: 5_000 })
        .catch(() => null);
      if (dlHref) entry.torrentUrl = resolveUrl(dlHref);
    } catch (err) {
      onProgress({
        phase: "detail",
        message: `Error: ${(err as Error).message}`,
        current: i + 1,
        total: topics.length,
      });
    }

    results.push(entry);
  }
  return { results, skipped };
}

// --- Public API ---

export async function crawl(
  config: Config,
  onProgress: (p: CrawlProgress) => void = () => {},
  existingUrls: Set<string> = new Set(),
): Promise<{ results: TopicData[]; skipped: number }> {
  const browser = await launchChromium({ headless: config.headless });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  try {
    await login(page, config, onProgress);
    const topics = await collectTopicUrls(page, config, onProgress);
    onProgress({
      phase: "listing",
      message: `Found ${topics.length} topics total`,
      total: topics.length,
    });
    const { results, skipped } = await extractTopicDetails(page, topics, existingUrls, config, onProgress);
    onProgress({ phase: "done", message: `Done — ${results.length} topics scraped` });
    return { results, skipped };
  } catch (err) {
    onProgress({ phase: "error", message: (err as Error).message });
    throw err;
  } finally {
    await browser.close();
  }
}
