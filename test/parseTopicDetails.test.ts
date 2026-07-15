import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTopicDetails } from "../src/core/scraping/shared.js";
import {
  SOFIYA_ERSHOVA_HTML,
  NICOLE_LOVE_HTML,
  V_ROLYAH_HTML,
} from "./fixtures/pornolab-topics.js";

/**
 * Minimal Playwright Page stub for testing parseTopicDetails.
 *
 * parseTopicDetails only uses:
 *   - page.locator(selector).first()
 *   - .getAttribute("title" | "href", { timeout })
 *   - .innerText({ timeout })
 *   - .count()
 *
 * The implementation extracts element ranges from the source HTML using
 * a balanced match for nested tags of the same name.
 */

// --- HTML extraction helpers ---

interface ExtractedTag {
  attrs: Record<string, string>;
  /** The full text content with <br /> converted to \n and nested tags stripped. */
  text: string;
}

/**
 * Find all ranges of a tag including its full body, even when nested.
 * Handles self-closing variants like <br />, <img />, <var ... />.
 */
function findAllTagRanges(html: string, tagName: string): { start: number; end: number }[] {
  const results: { start: number; end: number }[] = [];
  const openRe = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(html)) !== null) {
    if (m[0].endsWith("/>")) {
      results.push({ start: m.index, end: openRe.lastIndex });
      continue;
    }
    let depth = 1;
    const tokenRe = new RegExp(`<\\/?(${tagName})\\b[^>]*>`, "gi");
    tokenRe.lastIndex = openRe.lastIndex;
    while (depth > 0) {
      const tm = tokenRe.exec(html);
      if (!tm) break;
      if (tm[0].startsWith(`</`)) {
        depth--;
        if (depth === 0) {
          results.push({ start: m.index, end: tokenRe.lastIndex });
          break;
        }
      } else if (!tm[0].endsWith("/>")) {
        depth++;
      }
    }
  }
  return results;
}

function parseAttrs(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(attrStr)) !== null) {
    attrs[mm[1]!] = mm[2]!;
  }
  return attrs;
}

function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  // Decode common HTML entities
  s = s.replace(/&amp;/g, "&");
  s = s.replace(/&lt;/g, "<");
  s = s.replace(/&gt;/g, ">");
  s = s.replace(/&quot;/g, '"');
  s = s.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
  return s;
}

class FakeLocator {
  constructor(private readonly matches: ExtractedTag[]) {}

  first(): FakeLocator {
    return new FakeLocator(this.matches.slice(0, 1));
  }

  count(): Promise<number> {
    return Promise.resolve(this.matches.length);
  }

  async getAttribute(name: string, _opts?: unknown): Promise<string | null> {
    if (this.matches.length === 0) return null;
    return this.matches[0]!.attrs[name] ?? null;
  }

  async innerText(_opts?: unknown): Promise<string> {
    if (this.matches.length === 0) return "";
    return this.matches[0]!.text;
  }
}

function makeFakePage(html: string) {
  return {
    locator(selector: string): FakeLocator {
      const sel = selector.trim();

      // tag.class[.class]*
      const m = /^([a-zA-Z][\w-]*)(?:\.([\w-]+))(?:\.([\w-]+))?$/.exec(sel);
      if (m) {
        const tag = m[1]!;
        const cls1 = m[2]!;
        const cls2 = m[3];

        const ranges = findAllTagRanges(html, tag);
        const matches: ExtractedTag[] = [];
        for (const r of ranges) {
          const slice = html.slice(r.start, r.end);
          const openMatch = /^<\w+\b([^>]*)>/.exec(slice);
          if (!openMatch) continue;
          const attrs = parseAttrs(openMatch[1]!);
          const className = attrs["class"] ?? "";
          const classWords = className.split(/\s+/);

          if (!classWords.includes(cls1)) continue;
          if (cls2 && !classWords.includes(cls2)) continue;

          // For self-closing/void elements (like <var ... />) the text is empty.
          // Otherwise extract the inner content between the opening and closing tag.
          let text = "";
          if (!slice.endsWith("/>")) {
            const innerStart = r.start + openMatch[0].length;
            const innerEnd = r.end - (`</${tag}>`).length;
            text = htmlToText(html.slice(innerStart, innerEnd));
          }
          matches.push({ attrs, text });
        }
        return new FakeLocator(matches);
      }

      // .classname only
      const clsOnly = /^\.([\w-]+)$/.exec(sel);
      if (clsOnly) {
        const cls = clsOnly[1]!;
        const allTags = ["div", "span", "a", "var", "td", "tr", "table", "p", "h1", "fieldset", "legend"];
        const matches: ExtractedTag[] = [];
        for (const t of allTags) {
          const ranges = findAllTagRanges(html, t);
          for (const r of ranges) {
            const slice = html.slice(r.start, r.end);
            const openMatch = /^<\w+\b([^>]*)>/.exec(slice);
            if (!openMatch) continue;
            const attrs = parseAttrs(openMatch[1]!);
            const className = attrs["class"] ?? "";
            if (!className.split(/\s+/).includes(cls)) continue;
            let text = "";
            if (!slice.endsWith("/>")) {
              const innerStart = r.start + openMatch[0].length;
              const innerEnd = r.end - (`</${t}>`).length;
              text = htmlToText(html.slice(innerStart, innerEnd));
            }
            matches.push({ attrs, text });
          }
        }
        return new FakeLocator(matches);
      }

      // bare tag
      const bare = /^([a-zA-Z][\w-]*)$/.exec(sel);
      if (bare) {
        const tag = bare[1]!;
        const ranges = findAllTagRanges(html, tag);
        const matches: ExtractedTag[] = ranges.map((r) => {
          const slice = html.slice(r.start, r.end);
          const openMatch = /^<\w+\b([^>]*)>/.exec(slice);
          const attrs = openMatch ? parseAttrs(openMatch[1]!) : {};
          let text = "";
          if (openMatch && !slice.endsWith("/>")) {
            const innerStart = r.start + openMatch[0].length;
            const innerEnd = r.end - (`</${tag}>`).length;
            text = htmlToText(html.slice(innerStart, innerEnd));
          }
          return { attrs, text };
        });
        return new FakeLocator(matches);
      }

      return new FakeLocator([]);
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("parseTopicDetails", () => {
  describe("t=3283724 — Sofiya Ershova (Имена актёров: on same line)", () => {
    it("extracts starring from 'Имена актёров:' format", async () => {
      const page = makeFakePage(SOFIYA_ERSHOVA_HTML);
      const result = await parseTopicDetails(page as any);

      assert.equal(result.starring, "Sofiya Ershova, Steve Q");
    });

    it("extracts postImage and resolves to absolute URL", async () => {
      const page = makeFakePage(SOFIYA_ERSHOVA_HTML);
      const result = await parseTopicDetails(page as any);

      assert.equal(
        result.postImage,
        "https://i127.fastpic.org/big/2026/0516/dc/1aba2e23613df4e4750e1863f69221dc.jpg",
      );
    });

    it("extracts productionDate", async () => {
      const page = makeFakePage(SOFIYA_ERSHOVA_HTML);
      const result = await parseTopicDetails(page as any);

      assert.equal(result.productionDate, "25 февраля 2026 г.");
    });

    it("extracts duration", async () => {
      const page = makeFakePage(SOFIYA_ERSHOVA_HTML);
      const result = await parseTopicDetails(page as any);

      assert.equal(result.duration, "00:22:46");
    });

    it("extracts size from stats table", async () => {
      const page = makeFakePage(SOFIYA_ERSHOVA_HTML);
      const result = await parseTopicDetails(page as any);

      assert.equal(result.size, "4.21 GB");
    });

    it("extracts torrentUrl and resolves to absolute URL", async () => {
      const page = makeFakePage(SOFIYA_ERSHOVA_HTML);
      const result = await parseTopicDetails(page as any);

      assert.equal(result.torrentUrl, "https://pornolab.net/forum/dl.php?t=3283724");
    });
  });

  describe("t=3296016 — Nicole Love (Имя актрисы: on next line)", () => {
    it("extracts starring from 'Имя актрисы:' format (value on next line)", async () => {
      const page = makeFakePage(NICOLE_LOVE_HTML);
      const result = await parseTopicDetails(page as any);

      // The label "Имя актрисы:" is followed by a <br /> and then the value
      // "Nicole Love" on the next line. After converting <br /> to \n, the
      // captured group includes the trailing newlines.
      assert.ok(
        result.starring !== null && result.starring.includes("Nicole Love"),
        `expected starring to include "Nicole Love", got: ${JSON.stringify(result.starring)}`,
      );
    });

    it("extracts postImage (uses first <var class='postImg'>)", async () => {
      const page = makeFakePage(NICOLE_LOVE_HTML);
      const result = await parseTopicDetails(page as any);

      assert.equal(
        result.postImage,
        "https://i127.fastpic.org/big/2026/0712/60/960d1dc6158f2dc978fed377131e5b60.jpg",
      );
    });

    it("extracts productionDate", async () => {
      const page = makeFakePage(NICOLE_LOVE_HTML);
      const result = await parseTopicDetails(page as any);

      assert.equal(result.productionDate, "2026");
    });

    it("extracts duration", async () => {
      const page = makeFakePage(NICOLE_LOVE_HTML);
      const result = await parseTopicDetails(page as any);

      assert.equal(result.duration, "00:35:02");
    });

    it("extracts size from stats table", async () => {
      const page = makeFakePage(NICOLE_LOVE_HTML);
      const result = await parseTopicDetails(page as any);

      assert.equal(result.size, "1.85 GB");
    });

    it("extracts torrentUrl", async () => {
      const page = makeFakePage(NICOLE_LOVE_HTML);
      const result = await parseTopicDetails(page as any);

      assert.equal(result.torrentUrl, "https://pornolab.net/forum/dl.php?t=3296016");
    });
  });

  describe("classic 'В ролях:' format", () => {
    it("still works after regex change", async () => {
      const page = makeFakePage(V_ROLYAH_HTML);
      const result = await parseTopicDetails(page as any);

      assert.equal(result.starring, "Angelina Jolie, Brad Pitt");
      assert.equal(result.productionDate, "2024");
      assert.equal(result.duration, "01:45:00");
      assert.equal(result.size, "8.50 GB");
      assert.equal(result.torrentUrl, "https://pornolab.net/forum/dl.php?t=9999999");
    });
  });

  describe("missing fields", () => {
    it("returns nulls for all fields when post body is empty", async () => {
      const empty = `<html><body><div class="post-user-message"></div></body></html>`;
      const page = makeFakePage(empty);
      const result = await parseTopicDetails(page as any);

      assert.equal(result.postImage, null);
      assert.equal(result.starring, null);
      assert.equal(result.productionDate, null);
      assert.equal(result.duration, null);
      assert.equal(result.size, null);
      assert.equal(result.torrentUrl, null);
    });
  });
});
