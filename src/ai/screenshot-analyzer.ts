import { Jimp, JimpMime } from "jimp";
import { scrapeTopicImages } from "../core/images/topic-scraper.js";
import { resolverRegistry } from "../core/images/registry.js";
import { downloadImageViaBrowser } from "../core/images/browser-download.js";
import type { AiProviderClient } from "./providers/types.js";
import type { PerformerCharacteristics, ScreenshotAnalysis } from "./types.js";
import type { SceneCompositionTag } from "../core/types.js";

// See docs/ai.spec.md §6.1 — bounds local inference time / OpenRouter cost;
// a coarse characterization pass doesn't need every screenshot in a post.
// User-configurable (Config tab, AiConfig.screenshots) — these are just the
// fallback defaults used when a caller doesn't pass explicit limits.
const DEFAULT_MAX_IMAGES = 4;
// Max long edge in pixels, aspect ratio preserved. Forum screenshots are
// typically far larger than any vision model needs for this pass.
const DEFAULT_MAX_DIMENSION = 896;
const JPEG_QUALITY = 85;

export interface ScreenshotLimits {
  maxImages: number;
  maxDimension: number;
}

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

// The model reports gender per performer — including male performers — so
// scene composition (headcount, FFM/MMF, etc.) can be derived deterministic-
// ally from real counts rather than asked of the model as free-form
// reasoning (unreliable at this model size). Gender itself, and every male
// performer, is stripped back out before this becomes the final
// ScreenshotAnalysis — see RawPerformer/postProcess below and
// docs/ai.spec.md §6.6: only female performers feed the scoring output.
const RAW_PERFORMER_SCHEMA = {
  type: "object",
  properties: {
    gender: { type: "string", enum: ["female", "male"] },
    ...CHARACTERISTIC_SCHEMA.properties,
  },
  required: ["gender", ...CHARACTERISTIC_SCHEMA.required],
  additionalProperties: false,
};

const SCHEMA = {
  type: "object",
  properties: {
    tags: { type: "array", items: { type: "string" } },
    performers: { type: "array", items: RAW_PERFORMER_SCHEMA },
  },
  required: ["tags", "performers"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = [
  "You analyze screenshots taken from an adult video, all from the same scene.",
  "Output must match the given JSON schema exactly.",
  '"tags": short lowercase keywords describing scene/content visible across the images (setting, acts, camera angle, etc). Do not include performer headcount or gender-composition words like "threesome"/"gangbang"/"FFM"/"MMF" — those are added separately from your performer list, do not guess them yourself.',
  '"performers": one entry per visually distinct performer of ANY gender, ordered by how prominent/on-screen they are — the same performer appearing in multiple screenshots should only produce one entry. Include male performers too; they are filtered out later, but an accurate headcount and gender per performer matters.',
  '"gender": "female" or "male" for each performer — required, and the main reason male performers are listed at all.',
  "Every characteristic field is a fixed enum — if a value can't be determined from the images, use \"unknown\" rather than guessing. For a male performer, characteristics like breastSize don't apply — use \"unknown\" for those rather than guessing.",
  '"age" is a rough visual estimate of adult age range only, never a verified fact.',
  "If no performer is clearly visible in any image, return an empty performers array.",
].join(" ");

const USER_PROMPT = "Analyze these screenshots and describe them per the schema.";

export interface RawPerformer extends PerformerCharacteristics {
  gender: "female" | "male";
}

export interface RawScreenshotResult {
  tags: string[];
  performers: RawPerformer[];
}

// Optional out-param the caller can pass to recover a phase-by-phase timing
// breakdown (§10's per-item debug tooltip) without changing the return type
// for every other call site that doesn't care.
export interface ScreenshotTimings {
  getImagesMs: number;
  processScreensMs: number;
}

export async function analyzeScreenshots(
  topicUrl: string,
  client: AiProviderClient,
  timings?: ScreenshotTimings,
  limits?: ScreenshotLimits,
): Promise<ScreenshotAnalysis> {
  const fetchStart = Date.now();
  const images = await fetchAndResizeScreenshots(topicUrl, limits);
  if (timings) timings.getImagesMs = Date.now() - fetchStart;
  if (images.length === 0) {
    if (timings) timings.processScreensMs = 0;
    return { tags: [], performers: [] };
  }
  const visionStart = Date.now();
  const raw = await client.completeJson<RawScreenshotResult>({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: USER_PROMPT,
    images,
    schema: SCHEMA,
  });
  if (timings) timings.processScreensMs = Date.now() - visionStart;
  return postProcess(raw);
}

// Derives scene-composition tags from the real (model-reported) headcount
// and gender split, deterministically rather than asking the model to
// reason about it — see docs/ai.spec.md §6.6 for the exact thresholds and
// why. Then drops gender and every male performer: only female performers
// are exposed to scoring (the app's characteristic vocabulary — hair,
// breast size, etc. — is female-oriented anyway).
// Exported for direct unit testing — analyzeScreenshots() itself isn't
// unit tested (it also drives real screenshot scraping over the network/
// Playwright, same reasoning as the rest of this file), but this
// deterministic post-processing step benefits from real coverage.
export function postProcess(raw: RawScreenshotResult): ScreenshotAnalysis {
  const performers = raw.performers ?? [];
  const femaleCount = performers.filter((p) => p.gender === "female").length;
  const maleCount = performers.filter((p) => p.gender === "male").length;
  const total = performers.length;

  const sceneTags: SceneCompositionTag[] = [];
  if (total === 1) {
    sceneTags.push("Solo");
  } else if (total === 2) {
    sceneTags.push("Duo");
    if (femaleCount === 2) sceneTags.push("FF");
    else if (maleCount === 2) sceneTags.push("MM");
    else sceneTags.push("MF");
  } else if (total === 3) {
    sceneTags.push("Threesome");
    if (femaleCount === 2 && maleCount === 1) sceneTags.push("FFM");
    else if (maleCount === 2 && femaleCount === 1) sceneTags.push("MMF");
    else if (femaleCount === 3) sceneTags.push("FFF");
    else if (maleCount === 3) sceneTags.push("MMM");
  } else if (total > 3) {
    sceneTags.push("Gangbang");
  }

  const femalePerformers: PerformerCharacteristics[] = performers
    .filter((p) => p.gender === "female")
    .map(({ gender: _gender, ...characteristics }) => characteristics);

  return {
    tags: mergeTags(raw.tags ?? [], sceneTags),
    performers: femalePerformers,
  };
}

function mergeTags(tags: string[], extra: string[]): string[] {
  const seen = new Set(tags.map((t) => t.toLowerCase()));
  const merged = [...tags];
  for (const tag of extra) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(tag);
  }
  return merged;
}

async function fetchAndResizeScreenshots(topicUrl: string, limits?: ScreenshotLimits): Promise<Buffer[]> {
  const maxImages = limits?.maxImages ?? DEFAULT_MAX_IMAGES;
  const maxDimension = limits?.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const scraped = await scrapeTopicImages(topicUrl);
  const resolved = await resolverRegistry.resolveImages(scraped);
  const chosen = pickRandomInOrder(resolved, maxImages);

  const buffers: Buffer[] = [];
  for (const image of chosen) {
    const bytes = await fetchImageBytes(image.resolvedUrl);
    if (!bytes) continue;
    const resized = await resizeImage(bytes, maxDimension);
    if (resized) buffers.push(resized);
  }
  return buffers;
}

// Picks `count` items at random (no replacement) but returns them in their
// original relative order, so a scene's screenshots still read chronologic-
// ally even though which ones got picked isn't just "the first N".
function pickRandomInOrder<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const indices = items.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices
    .slice(0, count)
    .sort((a, b) => a - b)
    .map((i) => items[i]);
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

async function resizeImage(bytes: Buffer, maxDimension: number): Promise<Buffer | null> {
  try {
    const image = await Jimp.read(bytes);
    if (image.bitmap.width >= image.bitmap.height) {
      image.resize({ w: Math.min(maxDimension, image.bitmap.width) });
    } else {
      image.resize({ h: Math.min(maxDimension, image.bitmap.height) });
    }
    return await image.getBuffer(JimpMime.jpeg, { quality: JPEG_QUALITY });
  } catch {
    return null;
  }
}
