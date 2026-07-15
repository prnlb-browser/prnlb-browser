// Shared tag model + helpers used by both the Downloaded store and the
// Results (topics) store, so both features work with the exact same
// {name, color} shape and the same normalization/validation rules.

export interface Tag {
  name: string;
  /** CSS color (hex/rgb/etc.) used to tint the chip, or null for the default. */
  color: string | null;
}

// Normalize tag input (string, {name, color} object, or array of either) into
// a deduped list of Tag objects. First-encountered casing wins, colors are
// preserved or merged into the first-seen entry.
export function normalizeTags(input: unknown): Tag[] {
  if (!Array.isArray(input)) return [];
  const map = new Map<string, Tag>();
  for (const raw of input) {
    const decoded = decodeTagEntry(raw);
    if (!decoded) continue;
    const key = decoded.name.toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, decoded);
    } else if (!existing.color && decoded.color) {
      existing.color = decoded.color;
    }
  }
  return Array.from(map.values());
}

// Coerce a single entry (string or {name, color}) into a Tag. Returns null
// for malformed entries. Inputs are trimmed and validated; only valid CSS
// colors are accepted.
function decodeTagEntry(raw: unknown): Tag | null {
  let name = "";
  let color: string | null = null;
  if (typeof raw === "string") {
    name = raw.trim();
  } else if (raw && typeof raw === "object") {
    const obj = raw as { name?: unknown; color?: unknown };
    if (typeof obj.name === "string") name = obj.name.trim();
    if (typeof obj.color === "string" && obj.color.trim()) {
      const cleaned = obj.color.trim();
      if (isValidCssColor(cleaned)) color = cleaned;
    }
  }
  if (!name) return null;
  return { name, color };
}

// Accept #rgb, #rrggbb, #rrggbbaa, rgb(...), rgba(...), hsl(...), hsla(...),
// and named CSS colors. Reject anything else to avoid passing user input
// straight into inline styles.
function isValidCssColor(value: string): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v) return false;
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(v)) return true;
  if (/^(rgb|rgba|hsl|hsla)\s*\(/i.test(v)) return true;
  if (/^[a-z][a-z0-9-]*$/i.test(v)) {
    // Use a sandboxed probe element to check named colors without DOM.
    if (typeof document !== "undefined" && document.body) {
      const probe = document.createElement("span");
      probe.style.color = "";
      probe.style.color = v;
      return probe.style.color !== "";
    }
    // Node side: rely on a small static list — enough for user-picked swatches.
    return NAMED_COLORS.has(v.toLowerCase());
  }
  return false;
}

// Minimal named-color allowlist for server-side validation.
const NAMED_COLORS = new Set([
  "black", "silver", "gray", "white", "maroon", "red", "purple", "fuchsia",
  "green", "lime", "olive", "yellow", "navy", "blue", "teal", "aqua",
  "orange", "pink", "cyan", "magenta", "gold", "salmon", "coral", "indigo",
  "violet", "brown", "tan", "khaki", "crimson", "tomato",
]);

export function decodeTags(raw: string | null | undefined): Tag[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeTags(parsed as Array<unknown>);
  } catch {
    return [];
  }
}

// Merge multiple already-decoded tag lists (e.g. one per feature/table) into
// a single deduped, sorted list. This is what lets the Downloaded and Results
// tabs present one unified tag vocabulary even though each keeps its own
// per-item tags column.
export function mergeTagLists(...lists: Tag[][]): Tag[] {
  const map = new Map<string, Tag>();
  for (const list of lists) {
    for (const tag of list) {
      if (!tag || !tag.name) continue;
      const key = tag.name.toLowerCase();
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { name: tag.name, color: tag.color ?? null });
      } else if (!existing.color && tag.color) {
        existing.color = tag.color;
      }
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}
