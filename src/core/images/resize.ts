import { launchChromium } from "../browser.js";
import type { Page } from "playwright-core";

export interface ScaledImage {
  bytes: Buffer;
  mimeType: "image/jpeg";
  width: number;
  height: number;
}

type ImageDimensions = { width: number; height: number };

function detectMimeType(bytes: Buffer): string {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg";
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "image/jpeg";
}

/** Scale images in Chromium so the implementation works consistently across platforms. */
export async function scaleImageForAnalysis(bytes: Buffer, maxDimension: number): Promise<ScaledImage> {
  const browser = await launchChromium({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: maxDimension, height: maxDimension } });
    return await scaleOnPage(page, bytes, maxDimension);
  } finally {
    await browser.close();
  }
}

/** Scale several images with one browser instance to keep MCP calls efficient. */
export async function scaleImagesForAnalysis(bytesList: Buffer[], maxDimension: number): Promise<ScaledImage[]> {
  const browser = await launchChromium({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: maxDimension, height: maxDimension } });
    const scaled: ScaledImage[] = [];
    for (const bytes of bytesList) scaled.push(await scaleOnPage(page, bytes, maxDimension));
    return scaled;
  } finally {
    await browser.close();
  }
}

async function scaleOnPage(page: Page, bytes: Buffer, maxDimension: number): Promise<ScaledImage> {
  const source = `data:${detectMimeType(bytes)};base64,${bytes.toString("base64")}`;
  await page.setContent(`<!doctype html><style>html,body{margin:0;padding:0;background:#fff}img{display:block;max-width:${maxDimension}px;max-height:${maxDimension}px;width:auto;height:auto}</style><img id="image" src="${source}">`);
  await page.waitForFunction(() => {
    const image = document.getElementById("image") as HTMLImageElement | null;
    return !!image && image.complete && image.naturalWidth > 0;
  }, { timeout: 30_000 });

  const dimensions: ImageDimensions = await page.locator("#image").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  });
  const scaled = await page.locator("#image").screenshot({ type: "jpeg", quality: 82 });
  return { bytes: scaled, mimeType: "image/jpeg", ...dimensions };
}
