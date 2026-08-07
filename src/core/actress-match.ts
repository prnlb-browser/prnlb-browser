import type { Actress } from "./types.js";

// Server-side port of the "lowercased substring over title+Cast text"
// matching already used by the client-side ★ Fav actresses / actress:<id>
// filters (see castHaystack/matchesActressFilter in src/core/ui/helpers.js)
// — kept behaviorally identical rather than shared, since one runs in the
// browser bundle and one runs here, in AI scoring (src/ai/scoring.ts).
function stripCastAnnotation(text: string): string {
  return text.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

// Splits a scraped "Cast" string (e.g. "Jane Doe, John Smith (as Jane D.)")
// into individual performer names — used to fall back to the parsed cast
// when the AI title-analyzer doesn't find a given performer's name in the
// title itself (src/ai/title-analyzer.ts).
export function splitCastNames(starring: string | null): string[] {
  return stripCastAnnotation(starring || "")
    .split(/\s*[,;/]\s*|\s+&\s+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function actressNamesFor(actress: Actress): string[] {
  return [actress.name, ...(actress.otherNames || [])].filter(Boolean);
}

export interface ActressMatchContext {
  /** Canonical names of every catalogued actress found in this item's title+Cast text. */
  matchedNames: string[];
  /** Same, restricted to actresses marked favorite. */
  matchedFavoriteNames: string[];
}

export const EMPTY_ACTRESS_CONTEXT: ActressMatchContext = { matchedNames: [], matchedFavoriteNames: [] };

export function matchActresses(title: string, starring: string | null, actresses: Actress[]): ActressMatchContext {
  const hay = `${title || ""} ${stripCastAnnotation(starring || "")}`.toLowerCase();
  const matchedNames: string[] = [];
  const matchedFavoriteNames: string[] = [];
  for (const actress of actresses) {
    if (!actressNamesFor(actress).some((name) => hay.includes(name.toLowerCase()))) continue;
    matchedNames.push(actress.name);
    if (actress.isFavorite) matchedFavoriteNames.push(actress.name);
  }
  return { matchedNames, matchedFavoriteNames };
}
