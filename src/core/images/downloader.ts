import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolverRegistry } from "./registry.js";
import { downloadImageViaBrowser } from "./browser-download.js";

/**
 * Download a remote image and cache it locally under imagesDir. Used for
 * downloaded-item post images and actress pictures alike.
 * Returns the local filename (relative to imagesDir) or null on failure.
 */
export async function downloadAndCacheImage(
  imageUrl: string,
  cacheKey: string,
  imagesDir: string,
): Promise<string | null> {
  async function download(url: string): Promise<string | null> {
    const extension = path.extname(new URL(url).pathname) || ".jpg";
    const fileName = `${crypto.createHash("md5").update(cacheKey).digest("hex")}${extension}`;
    const response = await fetch(url);
    let buffer: Buffer | null = response.ok ? Buffer.from(await response.arrayBuffer()) : null;
    if (!buffer && response.status === 403) {
      // Some hosts (e.g. iafd.com) block plain HTTP clients behind a
      // Cloudflare challenge but serve the same image fine to a real browser.
      buffer = await downloadImageViaBrowser(url);
    }
    if (!buffer) return null;
    fs.writeFileSync(path.join(imagesDir, fileName), buffer);
    return fileName;
  }

  try {
    const resolver = resolverRegistry.findResolver(imageUrl);
    const resolved = resolver ? await resolver.resolve(imageUrl) : null;
    const downloaded = await download(resolved ?? imageUrl);
    if (downloaded) return downloaded;
  } catch {
    // Fall through to the original URL.
  }

  try {
    return await download(imageUrl);
  } catch {
    return null;
  }
}
