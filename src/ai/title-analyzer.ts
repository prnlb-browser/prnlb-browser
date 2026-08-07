import type { AiProviderClient } from "./providers/types.js";
import type { TitleAnalysis } from "./types.js";
import { splitCastNames } from "../core/actress-match.js";

const SCHEMA = {
  type: "object",
  properties: {
    actresses: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    quality: { type: "string", enum: ["4k", "1080p", "720p", "480p", "sd", "unknown"] },
  },
  required: ["actresses", "tags", "quality"],
  additionalProperties: false,
};

// Grounds the tiny default model (qwen2.5:0.5b) in this forum's actual title
// convention with a concrete worked example, since "don't include X" alone
// isn't reliable at that model size — cleanTags()/cleanActresses() below are
// a deterministic safety net for the same reason, not a substitute for it.
const SYSTEM_PROMPT = [
  "You extract structured data from a single adult-video forum topic title.",
  "Output must match the given JSON schema exactly.",
  "",
  "Titles on this forum commonly follow this pattern:",
  '"[Site1 / Site2 / Studio] Performer One, Performer Two - Description (ID) [Date, Tag1, Tag2, ..., ResolutionToken, SiteRip]"',
  "",
  "Example:",
  'Title: "[SiteA.com / SiteB.com / StudioX] Ivy Stone, Mia Rey - She Loves It Rough (1234567) [2026-03-01, Anal, Big Tits, Threesome (FFM), Redhead, Young, 1080p, SiteRip]"',
  'Output: {"actresses": ["Ivy Stone", "Mia Rey"], "tags": ["Anal", "Big Tits", "Threesome", "Redhead", "Young"], "quality": "1080p"}',
  "",
  "Rules:",
  '"actresses": the performer name(s) listed right after the leading [site/studio] bracket, before the " - " that introduces the description. Never take names from inside the leading bracket itself, even if a studio/channel name happens to look like a performer name.',
  '"tags": every comma-separated descriptor inside the trailing bracket, keeping their original casing, EXCEPT the leading date, the resolution token, and release-format words like "SiteRip"/"WEB-DL"/"Rip" — those are not tags. Drop any parenthetical qualifier from a tag, e.g. "Threesome (FFM)" becomes "Threesome".',
  '"quality": the resolution token from that trailing bracket (e.g. "1080p"), or "unknown" if none is present.',
  "If a title doesn't follow this pattern, fall back to extracting whatever performer names, descriptive keywords, and resolution are actually present in the text.",
  "Titles may be in English, Russian, or a mix of both.",
].join("\n");

const DATE_TOKEN = /^\d{4}-\d{2}-\d{2}$/;
const QUALITY_TOKEN = /^(4k|2160p|1080p|720p|480p|360p|sd)$/i;
const RELEASE_FORMAT_TOKEN = /^(site\s*rip|web-?dl|web-?rip|rip)$/i;

// Deterministic cleanup applied on top of the model's output — strips noise
// a small model may still slip through despite the prompt above (dates,
// resolution tokens, release-format words, parenthetical qualifiers) and
// dedupes case-insensitively, without depending on the model to get every
// instruction right on every call.
function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of tags) {
    const withoutQualifier = raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (!withoutQualifier) continue;
    if (DATE_TOKEN.test(withoutQualifier)) continue;
    if (QUALITY_TOKEN.test(withoutQualifier)) continue;
    if (RELEASE_FORMAT_TOKEN.test(withoutQualifier)) continue;
    const key = withoutQualifier.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(withoutQualifier);
  }
  return cleaned;
}

function cleanActresses(actresses: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of actresses) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(trimmed);
  }
  return cleaned;
}

// Falls back to the scraped "Cast" text (starring) for any performer it
// names who the title itself doesn't mention — titles don't always list
// every performer (or the small model misses one), but the Cast field
// often does. Only added when the title doesn't already mention the name,
// so this never overrides what the title-based extraction actually found.
function withCastFallback(actresses: string[], title: string, starring: string | null | undefined): string[] {
  const titleLower = title.toLowerCase();
  const withFallback = [...actresses];
  for (const castName of splitCastNames(starring ?? null)) {
    if (!titleLower.includes(castName.toLowerCase())) withFallback.push(castName);
  }
  return withFallback;
}

export async function analyzeTitle(
  title: string,
  client: AiProviderClient,
  starring?: string | null,
): Promise<TitleAnalysis> {
  const result = await client.completeJson<TitleAnalysis>({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: title,
    schema: SCHEMA,
  });
  return {
    ...result,
    actresses: cleanActresses(withCastFallback(result.actresses ?? [], title, starring)),
    tags: cleanTags(result.tags ?? []),
  };
}
