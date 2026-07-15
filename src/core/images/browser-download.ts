import { launchChromium } from "../browser.js";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Fallback for hosts (e.g. iafd.com) that sit behind a Cloudflare challenge
// and reject plain HTTP clients even for static image requests, but serve
// the image fine to a real browser navigation.
export async function downloadImageViaBrowser(url: string): Promise<Buffer | null> {
  const browser = await launchChromium({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!response || !response.ok()) return null;
    return await response.body();
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}
