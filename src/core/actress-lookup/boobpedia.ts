import type { ActressLookupDetails, ActressLookupProvider, ActressSearchMatch } from "./types.js";

const API_BASE = "https://www.boobpedia.com/boobs/api.php";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

function pageUrl(title: string): string {
  return `https://www.boobpedia.com/boobs/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

async function apiGet(params: Record<string, string>): Promise<any> {
  const url = new URL(API_BASE);
  url.searchParams.set("format", "json");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url.toString(), { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Boobpedia request failed (${response.status})`);
  return response.json();
}

// Strips common wiki markup (refs, [[links]], ''bold/italic'') down to plain text.
function cleanWikiValue(raw: string): string {
  return raw
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, "$1")
    .replace(/'{2,}/g, "")
    .trim();
}

function readBioboxField(bioboxBlock: string, key: string): string | null {
  // `[ \t]*`, not `\s*` — `\s` also matches newlines, which would let a
  // blank field (e.g. `| name =` followed immediately by the next line)
  // greedily swallow the following field's entire line as its "value".
  const match = bioboxBlock.match(new RegExp(`^\\|[ \\t]*${key}[ \\t]*=[ \\t]*(.*)$`, "im"));
  if (!match) return null;
  const value = cleanWikiValue(match[1] ?? "");
  return value || null;
}

// Parses the actress's `{{Biobox ...}}` infobox out of the page wikitext.
// Exported for unit testing against real wikitext fixtures.
export function parseBiobox(wikitext: string): { name: string | null; alias: string[]; photoFile: string | null } {
  const boxMatch = wikitext.match(/\{\{Biobox[^\n]*\n([\s\S]*?)\n\}\}/i);
  const block = boxMatch ? boxMatch[1]! : wikitext;

  const name = readBioboxField(block, "name");
  const aliasRaw = readBioboxField(block, "alias");
  const alias = aliasRaw ? aliasRaw.split(",").map((n) => n.trim()).filter(Boolean) : [];

  // Some pages use the legacy `Image:` namespace alias instead of `File:`.
  const photoMatch = block.match(/\|[ \t]*photo[ \t]*=[ \t]*\[\[(?:File|Image):([^\]|]+)/i);
  const photoFile = photoMatch ? photoMatch[1]!.trim() : null;

  return { name, alias, photoFile };
}

async function resolveFileUrl(fileName: string): Promise<string | null> {
  const data = await apiGet({ action: "query", titles: `File:${fileName}`, prop: "imageinfo", iiprop: "url" });
  const pages = data?.query?.pages ?? {};
  const page = Object.values(pages)[0] as { imageinfo?: { url?: string }[] } | undefined;
  return page?.imageinfo?.[0]?.url ?? null;
}

async function runSearch(query: string, extra: Record<string, string> = {}): Promise<ActressSearchMatch[]> {
  const data = await apiGet({ action: "query", list: "search", srsearch: query, srnamespace: "0", srlimit: "10", ...extra });
  const hits: { title: string }[] = data?.query?.search ?? [];
  return hits.map((hit) => ({ title: hit.title, url: pageUrl(hit.title) }));
}

// Boobpedia groups every stage name a performer has used under one biobox,
// keyed by whichever name editors picked as canonical (e.g. "Erica Mori" even
// when searched for by the alias "Polly Yang"). The page's own name always
// wins as primary; the caller is responsible for folding whatever name was
// searched for into aliases if it differs. Exported for unit testing.
export function resolvePrimaryName(pageName: string, alias: string[]): { primaryName: string; otherNames: string[] } {
  const otherNames = alias.filter((n) => n.toLowerCase() !== pageName.toLowerCase());
  return { primaryName: pageName, otherNames };
}

export const boobpediaProvider: ActressLookupProvider = {
  id: "boobpedia",
  label: "Boobpedia",

  async search(query: string): Promise<ActressSearchMatch[]> {
    const q = query.trim();
    if (!q) return [];
    // The default search profile weighs title matches heavily and returns
    // nothing for queries that only appear in a page's `alias` field (e.g. a
    // stage name listed under a different performer's canonical page).
    // Fall back to a plain full-text scan in that case.
    const titleHits = await runSearch(q);
    if (titleHits.length > 0) return titleHits;
    return runSearch(q, { srwhat: "text" });
  },

  async fetchDetails(title: string): Promise<ActressLookupDetails | null> {
    const data = await apiGet({ action: "parse", page: title, prop: "wikitext" });
    const wikitext: string | undefined = data?.parse?.wikitext?.["*"];
    if (!wikitext) return null;

    const { name, alias, photoFile } = parseBiobox(wikitext);
    const imageUrl = photoFile ? await resolveFileUrl(photoFile).catch(() => null) : null;

    const pageName = name || title;
    const { primaryName, otherNames } = resolvePrimaryName(pageName, alias);

    return { name: primaryName, otherNames, imageUrl, sourceUrl: pageUrl(title) };
  },
};
