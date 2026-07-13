import type { Browser, BrowserContext, Page } from "playwright-core";
import type { Config, TopicData, CrawlProgress } from "./types.js";
import { launchChromium } from "./browser.js";
import { handleCaptchaIfPresent } from "./captcha-handler.js";
import { sleep, randomDelay, resolveUrl, parseTopicDetails } from "./shared-scraper.js";

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

async function ensureLoggedIn(page: Page, config: Config, onProgress?: (p: CrawlProgress) => void): Promise<void> {
  if (loggedIn) return;

  const emit = (p: CrawlProgress) => { if (onProgress) onProgress(p); };

  await page.goto("https://pornolab.net/forum/tracker.php", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await sleep(2000);

  // Check if already logged in — look for user profile link
  const hasUserLink = (await page.locator(`a:has-text("${config.credentials.username}")`).count()) > 0;
  if (hasUserLink) {
    loggedIn = true;
    return;
  }

  // Look for the login form on the current page (header/sidebar login widget).
  // This avoids navigating to login.php which may redirect to index.php.
  const loginForm = page.locator('form[action="login.php"]');
  const formCount = await loginForm.count();

  if (formCount === 0) {
    // No login form found — may have been redirected, try checking for login
    // form after waiting longer (slow network / initial session setup)
    emit({ phase: "login", message: "Waiting for login form to appear..." });
    await page.waitForSelector('form[action="login.php"]', { timeout: 10_000 }).catch(() => {});
  }

  emit({ phase: "login", message: "Authenticating..." });

  // Retry loop — allows captcha to be entered again if code was wrong
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Check for captcha first (may appear on page reload after wrong code)
    const hasCaptcha = (await page.locator('img[src*="captcha"]').count()) > 0;
    if (hasCaptcha) {
      emit({ phase: "login", message: `Captcha challenge (attempt ${attempt})...` });
      const captchaHandled = await handleCaptchaIfPresent(page, (info) => {
        emit({
          phase: "captcha-needed",
          message: "CAPTCHA required — please enter the code from the image",
          captcha: info,
        });
      });
      if (!captchaHandled) {
        throw new Error("Captcha handling failed — could not find or submit captcha");
      }
    } else {
      // Verify the login form fields exist before trying to fill them
      const usernameField = page.locator('form[action="login.php"] input[name="login_username"]');
      const passwordField = page.locator('form[action="login.php"] input[name="login_password"]');

      if ((await usernameField.count()) === 0 || (await passwordField.count()) === 0) {
        // Login form fields not found — page may have changed (captcha with different markup,
        // blocked IP, etc.). Take a screenshot for debugging and re-check for captcha.
        console.warn(`Attempt ${attempt}: login form fields not found on page ${page.url()}`);

        // Re-check captcha with broader selectors
        const broadCaptcha =
          (await page.locator('img[src*="captcha"]').count()) > 0 ||
          (await page.locator('img[src*="capcha"]').count()) > 0 ||
          (await page.locator('input[name*="captcha"], input[name*="cap_code"]').count()) > 0;
        if (broadCaptcha) {
          // Found captcha with alternate selectors — go back to top of loop
          continue;
        }

        // Nothing we recognize — throw with page URL for debugging
        throw new Error(
          `Login form fields not found on ${page.url()} — the page may require captcha or have an unexpected layout`,
        );
      }

      // No captcha — fill credentials and submit directly from this page
      emit({ phase: "login", message: `Filling credentials (attempt ${attempt})...` });
      try {
        await usernameField.fill(config.credentials.username);
        await passwordField.fill(config.credentials.password);

        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {}),
          page
            .locator('form[action="login.php"] input[name="login"]')
            .click(),
        ]);
        await sleep(2000);
      } catch (err: any) {
        console.warn(`Attempt ${attempt}: credential fill/submit failed: ${err.message}`);
        // The page may have changed (e.g. captcha appeared mid-attempt). Re-check on next iteration.
        await sleep(1000);
        continue;
      }
    }

    // Verify login succeeded: either we're on a page with the username link
    // or we no longer see the login form
    const currentUrl = page.url();
    const hasUserLinkNow = (await page.locator(`a:has-text("${config.credentials.username}")`).count()) > 0;
    const loginFormGone = (await page.locator('form[action="login.php"]').count()) === 0;

    if (hasUserLinkNow || loginFormGone) {
      emit({ phase: "login", message: "Login successful!" });
      loggedIn = true;
      return;
    }

    // Check if we're still on a page with login form (wrong captcha, etc.)
    const stillOnLogin = page.locator('form[action="login.php"]');
    if ((await stillOnLogin.count()) > 0 && attempt < maxAttempts) {
      emit({ phase: "login", message: `Login attempt ${attempt} failed, retrying...` });
      continue;
    }
  }

  throw new Error("Login failed after maximum attempts — check credentials and captcha");
}

// --- Fetch forum options from tracker page ---

export async function fetchForumOptions(config: Config, onProgress?: (p: CrawlProgress) => void): Promise<ForumOption[]> {
  const { page } = await getBrowserContext(config);
  try {
    await ensureLoggedIn(page, config, onProgress);
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
    await ensureLoggedIn(page, config, onProgress);

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

      // Find the pagination link with exact start value using JS evaluation.
      // We can't use a simple CSS *-selector because `start=5` would match `start=50`,
      // so we evaluate each link's href and match the exact number.
      const paginationHref = await page.evaluate((targetStart: number) => {
        const links = document.querySelectorAll("a[href*='start=']");
        for (const link of Array.from(links)) {
          const href = (link as HTMLAnchorElement).getAttribute("href") || "";
          const match = href.match(/start=(\d+)/);
          if (match && parseInt(match[1], 10) === targetStart) {
            return href;
          }
        }
        return null;
      }, startOffset);

      if (paginationHref) {
        // Resolve relative URLs
        let targetUrl = paginationHref;
        if (!targetUrl.startsWith("http")) {
          const base = page.url();
          const baseUrl = base.split("?")[0];
          targetUrl = paginationHref.startsWith("?")
            ? baseUrl + paginationHref
            : new URL(paginationHref, base).href;
        }

        emit({ phase: "listing", message: `Navigating to page...` });
        await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await sleep(2000);
      } else {
        // Fallback: navigate by appending/replacing start= in the current URL
        let targetUrl = page.url();
        if (targetUrl.includes("start=")) {
          targetUrl = targetUrl.replace(/start=\d+/, `start=${startOffset}`);
        } else {
          const separator = targetUrl.includes("?") ? "&" : "?";
          targetUrl = `${targetUrl}${separator}start=${startOffset}`;
        }
        emit({ phase: "listing", message: `Navigating to page...` });
        await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await sleep(2000);
      }
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

      // Find max start value from pagination links.
      // Only consider links with checkPage=no (tracker pagination) or links
      // inside the main pagination nav to avoid matching random links on the page.
      let maxStart = 0;
      const allLinks = document.querySelectorAll("a[href*='start=']");
      for (const link of Array.from(allLinks)) {
        const href = link.getAttribute("href") || "";
        // Use a precise regex that matches start= exactly and captures the full number
        const match = href.match(/[?&]start=(\d+)/);
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
  onProgress?: (p: CrawlProgress) => void,
): Promise<{ postImage: string | null; starring: string | null; productionDate: string | null; duration: string | null }> {
  const { page } = await getBrowserContext(config);
  try {
    await ensureLoggedIn(page, config, onProgress);

    let url = topicUrl;
    if (!url.startsWith("http")) {
      url = "https://pornolab.net/forum/" + url.replace(/^\.\//, "");
    }

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await sleep(2000);

    const details = await parseTopicDetails(page);

    return {
      postImage: details.postImage,
      starring: details.starring,
      productionDate: details.productionDate,
      duration: details.duration,
    };
  } finally {
    await page.close();
  }
}
