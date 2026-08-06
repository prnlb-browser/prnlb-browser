import { Jimp, JimpMime } from "jimp";
import { scrapeTopicImages } from "../core/images/topic-scraper.js";
import { resolverRegistry } from "../core/images/registry.js";
import { downloadImageViaBrowser } from "../core/images/browser-download.js";
import type { AiProviderClient } from "./providers/types.js";
import type { ScreenshotAnalysis } from "./types.js";

// See docs/ai.spec.md §6.1 — bounds local inference time / OpenRouter cost;
// a coarse characterization pass doesn't need every screenshot in a post.
const MAX_IMAGES = 4;
// Max long edge in pixels, aspect ratio preserved. Forum screenshots are
// typically far larger than any vision model needs for this pass.
const MAX_DIMENSION = 896;
const JPEG_QUALITY = 85;

const CHARACTERISTIC_SCHEMA = {
  type: "object",
  properties: {
    hairColor: { type: "string", enum: ["blonde", "brunette", "black", "red", "colorful", "unknown"] },
    hairLength: { type: "string", enum: ["bald", "short", "shoulder-length", "long", "unknown"] },
    bodyType: { type: "string", enum: ["slim", "athletic", "average", "curvy", "bbw", "muscular", "unknown"] },
    age: { type: "string", enum: ["18-22", "23-27", "28-35", "36-45", "46+", "unknown"] },
    race: { type: "string", enum: ["asian", "ebony", "caucasian", "latina", "middle-eastern", "mixed", "unknown"] },
    breastSize: { type: "string", enum: ["small", "medium", "large", "extra-large", "unknown"] },
  },
  required: ["hairColor", "hairLength", "bodyType", "age", "race", "breastSize"],
  additionalProperties: false,
};

const SCHEMA = {
  type: "object",
  properties: {
    tags: { type: "array", items: { type: "string" } },
    performers: { type: "array", items: CHARACTERISTIC_SCHEMA },
  },
  required: ["tags", "performers"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = [
  "You analyze screenshots taken from an adult video, all from the same scene.",
  "Output must match the given JSON schema exactly.",
  '"tags": short lowercase keywords describing scene/content visible across the images (setting, acts, camera angle, etc).',
  '"performers": one entry per visually distinct performer, ordered by how prominent/on-screen they are — the same performer appearing in multiple screenshots should only produce one entry.',
  "Every characteristic field is a fixed enum — if a value can't be determined from the images, use \"unknown\" rather than guessing.",
  '"age" is a rough visual estimate of adult age range only, never a verified fact.',
  "If no performer is clearly visible in any image, return an empty performers array.",
].join(" ");

const USER_PROMPT = "Analyze these screenshots and describe them per the schema.";

export async function analyzeScreenshots(topicUrl: string, client: AiProviderClient): Promise<ScreenshotAnalysis> {
  const images = await fetchAndResizeScreenshots(topicUrl);
  if (images.length === 0) {
    return { tags: [], performers: [] };
  }
  return client.completeJson<ScreenshotAnalysis>({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: USER_PROMPT,
    images,
    schema: SCHEMA,
  });
}

async function fetchAndResizeScreenshots(topicUrl: string): Promise<Buffer[]> {
  const scraped = await scrapeTopicImages(topicUrl);
  const resolved = await resolverRegistry.resolveImages(scraped);
  const chosen = resolved.slice(0, MAX_IMAGES);

  const buffers: Buffer[] = [];
  for (const image of chosen) {
    const bytes = await fetchImageBytes(image.resolvedUrl);
    if (!bytes) continue;
    const resized = await resizeImage(bytes);
    if (resized) buffers.push(resized);
  }
  return buffers;
}

async function fetchImageBytes(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url);
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    // Some hosts Cloudflare-gate plain HTTP clients but serve the same
    // image fine to a real browser — same fallback used by downloader.ts.
    if (response.status === 403) return await downloadImageViaBrowser(url);
  } catch {
    // Fall through to null below.
  }
  return null;
}

async function resizeImage(bytes: Buffer): Promise<Buffer | null> {
  try {
    const image = await Jimp.read(bytes);
    if (image.bitmap.width >= image.bitmap.height) {
      image.resize({ w: Math.min(MAX_DIMENSION, image.bitmap.width) });
    } else {
      image.resize({ h: Math.min(MAX_DIMENSION, image.bitmap.height) });
    }
    return await image.getBuffer(JimpMime.jpeg, { quality: JPEG_QUALITY });
  } catch {
    return null;
  }
}
