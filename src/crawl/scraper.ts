import type { Browser, Page } from "playwright-core";
import type { Config, TopicData, CrawlProgress } from "../core/types.js";
import { launchChromium } from "../core/browser.js";
import { handleCaptchaIfPresent } from "../core/captcha-handler.js";
import { sleep, randomDelay, resolveUrl, parseTopicDetails } from "../core/scraping/shared.js";

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

  // Retry loop — allows captcha to be entered again if code was wrong
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Check for captcha first (may appear on page reload after wrong code)
    const hasCaptcha = (await page.locator('img[src*="captcha"]').count()) > 0;
    if (hasCaptcha) {
      onProgress({ phase: "login", message: `Captcha challenge (attempt ${attempt})...` });
      const captchaHandled = await handleCaptchaIfPresent(page, (info) => {
        onProgress({
          phase: "captchaNeeded",
          message: "CAPTCHA required — please enter the code from the image",
          captcha: info,
        });
      });
      if (!captchaHandled) {
        throw new Error("Captcha handling failed — could not find or submit captcha");
      }
    } else {
      // No captcha — fill credentials and submit
      onProgress({ phase: "login", message: `Filling credentials (attempt ${attempt})...` });
      await page
        .locator('form[action="login.php"] input[name="login_username"]')
        .fill(config.credentials.username);
      await page
        .locator('form[action="login.php"] input[name="login_password"]')
        .fill(config.credentials.password);

      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {}),
        page
          .locator('form[action="login.php"] input[name="login"]')
          .click(),
      ]);
      await sleep(2000);
    }

    // Verify login succeeded
    const url = page.url();
    const hasUserLink = (await page.locator(`a:has-text("${config.credentials.username}")`).count()) > 0;
    const onIndex = url.includes("index.php");

    if (hasUserLink || onIndex) {
      onProgress({ phase: "login", message: "Login successful!" });
      return;
    }

    // Check if we're still on the login page (wrong captcha, etc.)
    const stillOnLogin = page.locator('form[action="login.php"]');
    if ((await stillOnLogin.count()) > 0 && attempt < maxAttempts) {
      onProgress({ phase: "login", message: `Login attempt ${attempt} failed, retrying...` });
      continue;
    }
  }

  throw new Error("Login failed after maximum attempts — check credentials and captcha");
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

      const details = await parseTopicDetails(page);
      if (details.postImage) entry.postImage = details.postImage;
      if (details.starring) entry.starring = details.starring;
      if (details.productionDate) entry.productionDate = details.productionDate;
      if (details.duration) entry.duration = details.duration;
      if (details.size) entry.size = details.size;
      if (details.torrentUrl) entry.torrentUrl = details.torrentUrl;
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
