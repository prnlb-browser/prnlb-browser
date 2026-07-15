import type { Page } from "playwright-core";
import type { ActressLookupDetails, ActressLookupProvider, ActressSearchMatch } from "./types.js";
import { launchChromium } from "../browser.js";

const SEARCH_URL = "https://www.iafd.com/results.asp";
const SITE_BASE = "https://www.iafd.com/";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// IAFD sits behind a Cloudflare JS challenge that rejects plain HTTP
// requests (both curl and Node's fetch get a 403 "Just a moment..." page),
// so — unlike Boobpedia — this provider has to drive a real browser page and
// wait for the challenge to clear before reading the HTML.
async function waitForChallenge(page: Page, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const title = await page.title().catch(() => "");
    if (!/just a moment/i.test(title)) return;
    await page.waitForTimeout(500);
  }
}

async function fetchHtml(url: string): Promise<string> {
  const browser = await launchChromium({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await waitForChallenge(page);
    return await page.content();
  } finally {
    await browser.close();
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// IAFD tags names with the site that supplied the headshot, e.g.
// "Megan M (nubiles.net)" — strip that annotation, keeping just the name.
export function stripParenthetical(raw: string): string {
  return decodeHtmlEntities(raw)
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Parses the "Performers > Females" results table on a comprehensive-search
// results page into candidate matches. Exported for unit testing against a
// real HTML fixture.
export function parseSearchMatches(html: string): ActressSearchMatch[] {
  const tableMatch = html.match(/<table id="tblFem"[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return [];
  const rows = tableMatch[1]!.match(/<tr class="(?:odd|even)">[\s\S]*?<\/tr>/gi) ?? [];
  const matches: ActressSearchMatch[] = [];
  for (const row of rows) {
    const hrefMatch = row.match(/<a href="([^"]+)"/i);
    if (!hrefMatch) continue;
    const path = hrefMatch[1]!;
    matches.push({ title: path, url: new URL(path, SITE_BASE).toString() });
  }
  return matches;
}

// Parses a performer's detail page (/person.rme/id=...) for their primary
// name, AKA list, and headshot. Exported for unit testing.
export function parsePersonPage(html: string): { name: string | null; otherNames: string[]; imageUrl: string | null } {
  const nameMatch = html.match(/<h1>\s*([^<]+?)\s*<\/h1>/i);
  const name = nameMatch ? stripParenthetical(nameMatch[1]!) : null;

  const imageMatch = html.match(/<div id="headshot">\s*<img[^>]+src="([^"]+)"/i);
  const imageUrl = imageMatch ? imageMatch[1]! : null;

  const akaMatch = html.match(/<p class="bioheading">\s*(?:Performer\s+)?AKA\s*<\/p>\s*<div class="biodata">([\s\S]*?)<\/div>/i);
  const otherNames = akaMatch
    ? akaMatch[1]!
        .split(/<br\s*\/?>/i)
        .map((entry) => stripParenthetical(stripTags(entry)))
        .filter(Boolean)
    : [];

  return { name, otherNames, imageUrl };
}

export const iafdProvider: ActressLookupProvider = {
  id: "iafd",
  label: "IAFD",

  async search(query: string): Promise<ActressSearchMatch[]> {
    const q = query.trim();
    if (!q) return [];
    const url = `${SEARCH_URL}?searchtype=comprehensive&searchstring=${encodeURIComponent(q)}`;
    const html = await fetchHtml(url);
    return parseSearchMatches(html);
  },

  async fetchDetails(title: string): Promise<ActressLookupDetails | null> {
    const url = new URL(title, SITE_BASE).toString();
    const html = await fetchHtml(url);
    const { name, otherNames, imageUrl } = parsePersonPage(html);
    if (!name) return null;
    return { name, otherNames, imageUrl, sourceUrl: url };
  },
};
