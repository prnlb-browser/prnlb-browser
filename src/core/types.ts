import type { Tag } from "./tags.js";

// AI topic rating (see docs/ai.spec.md). Both provider sub-objects are
// always present even though only `provider`'s settings are used, so the
// Config tab doesn't lose the other provider's typed-in values when the
// user switches between them.
export type AiProvider = "ollama" | "openrouter";

// Coarse, closed-enum performer characteristics extracted by the screenshot
// analyzer (src/ai/screenshot-analyzer.ts). Kept here (not in src/ai/) so
// AiScoreRule/AiConfig can reference them without core depending on a
// feature folder. "unknown" is an explicit member rather than null so the
// whole set stays enum-constrained for structured model output.
export type HairColor = "blonde" | "brunette" | "black" | "red" | "colorful" | "unknown";
export type HairLength = "bald" | "short" | "shoulder-length" | "long" | "unknown";
export type BodyType = "slim" | "athletic" | "average" | "curvy" | "bbw" | "muscular" | "unknown";
export type AgeBracket = "18-22" | "23-27" | "28-35" | "36-45" | "46+" | "unknown";
export type Race = "asian" | "ebony" | "caucasian" | "latina" | "middle-eastern" | "mixed" | "unknown";
export type BreastSize = "small" | "medium" | "large" | "extra-large" | "unknown";

// Other than "unknown" (deliberately shared, and excluded from the scoring
// rule editor for that reason — see AiScoreRule), the six enums above share
// no literal values, so a single value (e.g. "blonde") unambiguously
// identifies which characteristic it belongs to — AiScoreRule doesn't need
// a separate field selector. Renamed HairLength's "medium" to
// "shoulder-length" and Race's "black" to "ebony" specifically to avoid
// colliding with BreastSize's "medium" and HairColor's "black".
export type PerformerCharacteristicValue = HairColor | HairLength | BodyType | AgeBracket | Race | BreastSize;

// A user-configured rule contributing to a topic's AI rating (see
// docs/ai.spec.md §8). "tag" rules do a case-insensitive substring match
// against combined title+screenshot tags; "performer-characteristic" rules
// do an exact match against any performer's characteristic fields;
// "actress" rules match against the Actress catalogue (src/actresses/) via
// the item's title+Cast text — see src/core/actress-match.ts. `value` is
// either the literal "favorite" (any favorited actress appears), the
// literal "saved" (any catalogued actress appears, favorite or not), or a
// specific actress's exact name (case-insensitive) — the rule editor's
// dropdown only ever offers those three shapes, but the type itself is
// just `string` since the catalogue is user data, not a fixed enum.
export type AiScoreRule =
  | { type: "tag"; value: string; weight: number }
  | { type: "performer-characteristic"; value: PerformerCharacteristicValue; weight: number }
  | { type: "actress"; value: string; weight: number };

export interface AiConfig {
  enabled: boolean;
  provider: AiProvider;
  ollama: {
    baseUrl: string;
    textModel: string;
    visionModel: string;
  };
  openrouter: {
    apiKey: string;
    textModel: string;
    visionModel: string;
  };
  scoring: {
    rules: AiScoreRule[];
  };
}

export interface Config {
  credentials: { username: string; password: string };
  forums: { url: string; label: string }[];
  pagesToScan: number;
  headless: boolean;
  delay: { min: number; max: number };
  dbPath: string;
  downloadedFolder?: string;
  ai: AiConfig;
}

export interface TopicData {
  title: string;
  postImage: string | null;
  starring: string | null;
  productionDate: string | null;
  duration: string | null;
  size: string | null;
  torrentUrl: string | null;
  topicUrl: string;
  sourceForum: string | null;
  hidden: number; // 0 or 1
  // Free-form tags assigned by the user. Shares the same {name, color} model
  // and the same tag vocabulary as DownloadedItem.tags — see src/core/tags.ts.
  tags?: DownloadedTag[] | null;
  // 0-100 AI rating from the configured scoring rules (see docs/ai.spec.md
  // §7/§8), or null if never analyzed. Only the score is persisted — the
  // raw title/screenshot analysis that produced it is not stored.
  aiRating?: number | null;
}

export interface CrawlProgress {
  phase:
    | "login"
    | "listing"
    | "detail"
    | "done"
    | "error"
    | "captchaNeeded"
    | "idle"
    | "results"
    | "result"
    | "processing"
    | "purge"
    | "imagesFolder"
    | "scan"
    | "itemDone"
    | "resolving"
    | "scraping";
  message: string;
  current?: number;
  total?: number;
  captcha?: CaptchaInfo;
}

// Same shape as the shared Tag type (src/core/tags.ts) — kept as its own
// named type since it's the historical/public name used across the app.
export type DownloadedTag = Tag;

export interface CaptchaInfo {
  imageBase64: string; // data:image/png;base64,...
  captchaId: string;
}

export interface Actress {
  id: number;
  name: string;
  // Alternate names/aliases this actress is also known by. Used to match
  // free-text "Cast" values that don't use the primary name.
  otherNames: string[];
  postImage: string | null; // remote URL used to resolve the cached picture
  cachedImage: string | null; // local filename inside the actress images folder
  isFavorite: boolean;
  createdAt: string;
}

export interface DownloadedItem {
  id: number;
  fileName: string;
  filePath: string;
  title: string | null;
  topicUrl: string | null;
  postImage: string | null; // remote URL of the topic's post image
  cachedImage: string | null; // local filename inside the .images folder
  starring: string | null;
  productionDate: string | null;
  duration: string | null;
  size: string | null;
  createdAt: string;
  // Free-form tags assigned by the user (e.g. "favorite", "watched", custom labels).
  // Each tag has an optional color used to tint its chip in the UI.
  tags?: DownloadedTag[] | null;
  // OS-level file stats, populated on demand by the route layer for sort/filter.
  // Null when the file is missing or stats are unavailable.
  fileSizeBytes?: number | null;
  fileMtimeMs?: number | null;
  fileBirthtimeMs?: number | null;
  // 0-100 AI rating, same semantics as TopicData.aiRating — null if never
  // analyzed. Only settable via items that have a topicUrl (screenshot
  // analysis needs one to scrape from).
  aiRating?: number | null;
}
