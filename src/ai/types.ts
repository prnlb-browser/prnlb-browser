import type { AgeBracket, BodyType, BreastSize, HairColor, HairLength, Race } from "../core/types.js";

// See docs/ai.spec.md §5 — output of the title analyzer.
export type VideoQuality = "4k" | "1080p" | "720p" | "480p" | "sd" | "unknown";

export interface TitleAnalysis {
  /** Performer names found in the title text. [] if none. */
  actresses: string[];
  /** Short, lowercase descriptive keywords found in the title text. */
  tags: string[];
  /** Resolution as stated in the title, bucketed into the enum. */
  quality: VideoQuality;
}

// See docs/ai.spec.md §6 — output of the screenshot analyzer.
export interface PerformerCharacteristics {
  hairColor: HairColor;
  hairLength: HairLength;
  bodyType: BodyType;
  /** Apparent age bracket from visual appearance only — a rough estimate, never treated as verified age. */
  age: AgeBracket;
  race: Race;
  breastSize: BreastSize;
}

export interface ScreenshotAnalysis {
  /** Scene/content descriptive tags visible across the screenshots. */
  tags: string[];
  /** One entry per visually distinct performer, ordered by prominence. Unlabeled — not matched to a name. [] if no performer is clearly visible. */
  performers: PerformerCharacteristics[];
}
