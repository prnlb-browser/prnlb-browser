import type { Tag } from "./tags.js";

export interface Config {
  credentials: { username: string; password: string };
  forums: { url: string; label: string }[];
  pagesToScan: number;
  headless: boolean;
  delay: { min: number; max: number };
  dbPath: string;
  downloadedFolder?: string;
  // Shared on-disk cache for topic screenshots shown in the "Screens"
  // preview carousel. When a write would push the cache over this limit,
  // the oldest (by last-read time) files are deleted first. 0 disables it.
  screenshotCache: { maxSizeMB: number };
  mcp: { enabled: boolean };
}

export type ItemRef =
  | { type: "result"; topicUrl: string }
  | { type: "downloaded"; id: number };

export type NavigateDestination = "topic" | "file" | "folder" | "app";

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
  // Existing 0-100 item rate. The calculation is intentionally outside this
  // application; only the value and its sorting are retained here.
  aiRating?: number | null;
  // User-maintained context for future review or AI analysis.
  comments?: string | null;
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
  // Existing 0-100 item rate. The calculation is intentionally outside this
  // application; only the value and its sorting are retained here.
  aiRating?: number | null;
  // User-maintained context for future review or AI analysis.
  comments?: string | null;
}
