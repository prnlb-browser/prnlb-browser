import type { Browser, BrowserContext, Page } from "playwright-core";
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
  if (!href) return href;
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return "https:" + href;
  return `https://pornolab.net/forum/${href.replace(/^\.\//, "")}`;
}

// --- Types ---

export interface SearchOptions {
  query: string;
  forums?: number[]; // forum IDs to filter by
  sort?: number;     // sort mode (1=date, 2=seeds desc — default 2)
  start?: number;    // pagination offset (0, 50, 100, ...)
}

export interface PaginationInfo {
  currentPage: number; // 1-based
  totalPages: number;
  perPage: number;     // 50
}

export interface SearchResult {
  results: TopicData[];
  pagination: PaginationInfo;
}

export interface ForumOption {
  id: number;
  name: string;
}

// --- Shared browser management ---

let sharedBrowser: Browser | null = null;
let sharedContext: BrowserContext | null = null;
let loggedIn = false;

async function getBrowserContext(config: Config): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await launchChromium({ headless: config.headless ?? true });
    sharedContext = await sharedBrowser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    });
    loggedIn = false;
  }
  const page = await sharedContext!.newPage();
  return { browser: sharedBrowser, context: sharedContext!, page };
}

async function closeSharedBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
    sharedContext = null;
    loggedIn = false;
  }
}

// --- Login helper ---

async function ensureLoggedIn(page: Page, config: Config): Promise<void> {
  if (loggedIn) return;

  await page.goto("https://pornolab.net/forum/tracker.php", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await sleep(2000);

  // Check if already logged in
  const loginForm = page.locator('form[action="login.php"]');
  if ((await loginForm.count()) === 0) {
    loggedIn = true;
    return;
  }

  // Need to login
  await page.goto("https://pornolab.net/forum/login.php", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await sleep(1000);

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

  loggedIn = true;
}

// --- Fetch forum options from tracker page ---

export async function fetchForumOptions(config: Config): Promise<ForumOption[]> {
  const { page } = await getBrowserContext(config);
  try {
    await ensureLoggedIn(page, config);
    await page.goto("https://pornolab.net/forum/tracker.php", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await sleep(2000);

    const options = await page.evaluate(() => {
      const select = document.getElementById("fs-main");
      if (!select) return [];
      const opts: { id: number; name: string }[] = [];
      for (const opt of Array.from(select.querySelectorAll("option"))) {
        const val = parseInt(opt.getAttribute("value") || "", 10);
        const name = opt.textContent?.trim() || "";
        if (!isNaN(val) && val > 0 && name) {
          opts.push({ id: val, name });
        }
      }
      return opts;
    });

    return options;
  } finally {
    await page.close();
  }
}

// --- Search tracker ---

export async function searchPornolab(
  config: Config,
  options: SearchOptions,
  onProgress?: (p: CrawlProgress) => void,
): Promise<SearchResult> {
  const emit = (p: CrawlProgress) => { if (onProgress) onProgress(p); };
  const { page } = await getBrowserContext(config);

  try {
    // Login
    emit({ phase: "login", message: "Authenticating..." });
    await ensureLoggedIn(page, config);

    // Navigate to tracker
    emit({ phase: "listing", message: "Opening search page..." });
    await page.goto("https://pornolab.net/forum/tracker.php", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await sleep(2000);

    // Fill in the search form using the actual form fields
    emit({ phase: "listing", message: `Searching: "${options.query}"...` });

    // Fill search query — use #title-search to target the tracker form input (not the header search)
    const nmInput = page.locator('#title-search');
    if ((await nmInput.count()) > 0) {
      await nmInput.fill(options.query);
    }

    // Set sort (radio buttons)
    const sortVal = String(options.sort ?? 2);
    const sortRadio = page.locator(`input[name="s"][value="${sortVal}"]`);
    if ((await sortRadio.count()) > 0) {
      await sortRadio.check();
    }

    // Set forum filter
    if (options.forums && options.forums.length > 0 && !options.forums.includes(-1)) {
      await page.evaluate((forumIds: number[]) => {
        const select = document.getElementById("fs-main") as HTMLSelectElement | null;
        if (!select) return;
        // Deselect all
        for (const opt of Array.from(select.options)) {
          opt.selected = false;
        }
        // Select specified forums
        for (const opt of Array.from(select.options)) {
          if (forumIds.includes(parseInt(opt.value, 10))) {
            opt.selected = true;
          }
        }
      }, options.forums);
    }

    // Submit the form by clicking the submit button
    const submitBtn = page.locator("#tracker-submit");
    if ((await submitBtn.count()) > 0) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}),
        submitBtn.click(),
      ]);
    } else {
      // Fallback
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}),
        page.locator('#tr-form input[type="submit"]').first().click().catch(async () => {
          await page.evaluate(() => {
            const form = document.getElementById("tr-form") as HTMLFormElement;
            if (form) form.submit();
          });
        }),
      ]);
    }

    await sleep(2000);

    // Handle pagination — use the page's own pagination links which naturally
    // carry all search parameters (query, forums, sort, start).
    // This avoids the issue of the form using POST and losing forum filters.
    const startOffset = options.start ?? 0;
    if (startOffset > 0) {
      emit({ phase: "listing", message: `Navigating to page ${Math.floor(startOffset / 50) + 1}...` });

      // Find the selector for the pagination link with the target start value
      const paginationSelector = `a[href*="tracker.php"][href*="start=${startOffset}"]`;
      const paginationLink = page.locator(paginationSelector).first();
      const hasLink = (await paginationLink.count()) > 0;

      if (hasLink) {
        // Click the pagination link — it naturally preserves all search params
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}),
          paginationLink.click(),
        ]);
      } else {
        // Fallback: re-submit the form with injected start field
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}),
          page.evaluate((start: number) => {
            const form = document.getElementById("tr-form") as HTMLFormElement | null;
            if (!form) return;
            const existing = form.querySelector('input[name="start"]');
            if (existing) existing.remove();
            const input = document.createElement("input");
            input.type = "hidden";
            input.name = "start";
            input.value = String(start);
            form.appendChild(input);
            form.submit();
          }, startOffset),
        ]);
      }

      await sleep(2000);
    }

    // Debug: emit page URL and title after form submission
    const pageUrl = page.url();
    const pageTitle = await page.title();
    const debugRowCount = await page.evaluate(() => {
      return document.querySelectorAll("#tor-tbl tr.tCenter").length;
    });
    emit({ phase: "detail", message: `Page: ${pageTitle} (${pageUrl}), rows: ${debugRowCount}` });

    // Parse results from the page
    emit({ phase: "detail", message: "Parsing search results..." });

    const results = await page.evaluate(() => {
      const items: {
        title: string;
        topicUrl: string;
        postImage: string | null;
        size: string | null;
        torrentUrl: string | null;
        sourceForum: string | null;
        topicId: string | null;
      }[] = [];

      // The tracker results are in #tor-tbl (class "forumline tablesorter")
      // Each result is a <tr class="tCenter"> row with ~11 cells
      const rows = document.querySelectorAll("#tor-tbl tr.tCenter");

      for (const row of Array.from(rows)) {
        const cells = row.querySelectorAll("td");
        if (cells.length < 7) continue;

        // Column layout (10 cells):
        // 0: icon (row1)
        // 1: status icon (row1 tCenter) — e.g. approved checkmark
        // 2: forum category link (row1)
        // 3: topic title (row4 med tLeft u) — contains <a class="med tLink bold">
        // 4: author (row1)
        // 5: size + torrent link (row4 small nowrap) — <a class="tr-dl" href="dl.php?t=...">
        // 6: seeds
        // 7: leeches
        // 8: downloads
        // 9: last activity

        // Forum category
        const forumCell = cells[2]!;
        const forumLink = forumCell.querySelector("a");
        const sourceForum = forumLink?.textContent?.trim() || null;

        // Topic title + link
        const titleCell = cells[3]!;
        const topicLink = titleCell.querySelector("a.tLink") || titleCell.querySelector("a[href*='viewtopic.php']");
        if (!topicLink) continue;

        const title = topicLink.textContent?.trim() || "";
        let href = topicLink.getAttribute("href") || "";
        if (href && !href.startsWith("http")) {
          href = "https://pornolab.net/forum/" + href.replace(/^\.\//, "");
        }
        const topicUrl = href;
        if (!title || !topicUrl) continue;

        // Extract topic ID from URL
        const topicIdMatch = topicUrl.match(/t=(\d+)/);
        const topicId = topicIdMatch ? topicIdMatch[1]! : null;

        // Size + Torrent download link (same cell)
        const sizeCell = cells[5]!;
        let size: string | null = null;
        let torrentUrl: string | null = null;
        const dlLink = sizeCell.querySelector("a[href*='dl.php']");
        if (dlLink) {
          size = dlLink.textContent?.trim() || null;
          let dlHref = dlLink.getAttribute("href") || "";
          if (dlHref && !dlHref.startsWith("http")) {
            dlHref = "https://pornolab.net/forum/" + dlHref.replace(/^\.\//, "");
          }
          torrentUrl = dlHref || null;
        }

        // No images on tracker results page — only on topic detail pages
        let postImage: string | null = null;

        items.push({ title, topicUrl, postImage, size, torrentUrl, sourceForum, topicId });
      }

      return items;
    });

    // Convert to TopicData format
    const topics: TopicData[] = results.map((r) => ({
      title: r.title,
      postImage: r.postImage,
      starring: null,
      productionDate: null,
      duration: null,
      size: r.size,
      torrentUrl: r.torrentUrl,
      topicUrl: r.topicUrl,
      sourceForum: r.sourceForum,
      hidden: 0,
    }));

    // Parse pagination info from the page
    const pagination: PaginationInfo = await page.evaluate(() => {
      const PER_PAGE = 50;

      // Current page from URL
      const urlMatch = window.location.href.match(/start=(\d+)/);
      const currentStart = urlMatch ? parseInt(urlMatch[1], 10) : 0;
      const currentPage = Math.floor(currentStart / PER_PAGE) + 1;

      // Find max start value from pagination links
      let maxStart = 0;
      const allLinks = document.querySelectorAll("a[href*='start=']");
      for (const link of Array.from(allLinks)) {
        const href = link.getAttribute("href") || "";
        const match = href.match(/start=(\d+)/);
        if (match) {
          const s = parseInt(match[1], 10);
          if (s > maxStart) maxStart = s;
        }
      }

      const totalPages = maxStart > 0 ? Math.floor(maxStart / PER_PAGE) + 1 : 1;
      return { currentPage, totalPages, perPage: PER_PAGE };
    });

    emit({ phase: "done", message: `Found ${topics.length} results (page ${pagination.currentPage}/${pagination.totalPages})` });
    return { results: topics, pagination };
  } finally {
    await page.close();
  }
}

// --- Fetch topic details (post image + metadata) ---

export async function fetchTopicDetails(
  topicUrl: string,
  config: Config,
): Promise<{ postImage: string | null; starring: string | null; productionDate: string | null; duration: string | null }> {
  const { page } = await getBrowserContext(config);
  try {
    await ensureLoggedIn(page, config);

    let url = topicUrl;
    if (!url.startsWith("http")) {
      url = "https://pornolab.net/forum/" + url.replace(/^\.\//, "");
    }

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await sleep(2000);

    const details = await page.evaluate(() => {
      // Post image — <var class="postImg" title="URL">
      const postImg = document.querySelector("var.postImg");
      const postImage = postImg ? postImg.getAttribute("title") : null;

      // Metadata from post body text
      const postEl = document.querySelector(".post-user-message");
      const postText = postEl ? (postEl as HTMLElement).innerText || "" : "";

      const starringMatch = postText.match(/В ролях[:\s]*([^\n]+)/i);
      const starring = starringMatch ? starringMatch[1]?.trim() || null : null;

      const dateMatch = postText.match(/Дата производства[:\s]*([^\n]+)/i);
      const productionDate = dateMatch ? dateMatch[1]?.trim() || null : null;

      const durationMatch = postText.match(/Продолжительность[:\s]*([^\n]+)/i);
      const duration = durationMatch ? durationMatch[1]?.trim() || null : null;

      return { postImage, starring, productionDate, duration };
    });

    return {
      postImage: details.postImage ? resolveUrl(details.postImage) : null,
      starring: details.starring,
      productionDate: details.productionDate,
      duration: details.duration,
    };
  } finally {
    await page.close();
  }
}
