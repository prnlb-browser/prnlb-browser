// --- Helpers ---

// Canonical ordering for topic detail metadata labels.
// Labels are grouped into two visual rows: header (File/Forum) and details (Cast/Date/Duration/Size).
const META_FIELD_ORDER = ["File:", "Forum:", "Cast:", "Date:", "Duration:", "Size:"];
const META_FIELD_GROUP = { "File:": 0, "Forum:": 0, "Cast:": 1, "Date:": 1, "Duration:": 1, "Size:": 1 };
const META_GROUP_CLASS = ["result-meta-row result-meta-row--header", "result-meta-row result-meta-row--details"];

function metaFieldRank(label) {
  const idx = META_FIELD_ORDER.indexOf(label);
  return idx === -1 ? META_FIELD_ORDER.length : idx;
}

// Return the row element in metaDiv that holds the given label's group, creating it if needed.
// Rows are appended in canonical order (header before details).
function ensureMetaRow(metaDiv, label) {
  const groupIdx = META_FIELD_GROUP[label] ?? 1;
  const rows = metaDiv.querySelectorAll(":scope > .result-meta-row");
  let row = rows[groupIdx];
  if (!row) {
    row = document.createElement("div");
    row.className = META_GROUP_CLASS[groupIdx];
    // Insert in canonical order: lower-group rows come first.
    let inserted = false;
    for (let i = 0; i < META_GROUP_CLASS.length; i++) {
      if (i === groupIdx) continue;
      const sibling = rows[i];
      if (sibling && i > groupIdx) {
        metaDiv.insertBefore(row, sibling);
        inserted = true;
        break;
      }
    }
    if (!inserted) metaDiv.appendChild(row);
  }
  return row;
}

// Insert a span in a meta container at the position determined by META_FIELD_ORDER.
// Cast/Date/Duration/Size go in the "details" row (separated from File/Forum by a line break).
function appendMetaField(metaDiv, newSpan, label) {
  const newRank = metaFieldRank(label);
  const targetRow = ensureMetaRow(metaDiv, label);
  const existingSpans = Array.from(targetRow.querySelectorAll("span"));
  let insertBefore = null;
  for (const span of existingSpans) {
    const labelEl = span.querySelector(".label");
    if (labelEl) {
      const rank = metaFieldRank(labelEl.textContent || "");
      if (rank > newRank) {
        insertBefore = span;
        break;
      }
    }
  }
  if (insertBefore) {
    targetRow.insertBefore(newSpan, insertBefore);
  } else {
    targetRow.appendChild(newSpan);
  }
}

// Render text/attribute content as HTML-safe. Strings end up inside both
// text nodes and double-quoted attribute values throughout the renderer
// (titles, URLs, JSON-encoded data-* attributes, …), so escape all four
// entities the HTML parser cares about. The previous implementation only
// escaped & < >, which left literal " characters inside attribute values
// and caused the HTML parser to truncate the attribute at the first
// embedded quote — see the data-tags / remove-tag chip regression.
function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Strip a trailing "(...)" annotation from a cast name, e.g.
// "Megan Murkovski (Megan Longoria)" -> "Megan Murkovski". The parenthetical
// is a human note (an alias/real name) and must not be treated as part of
// the actress's name for lookup, creation, or filter matching.
function stripCastAnnotation(text) {
  return text.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

// Render a "Cast" value as clickable actress links, split on commas. Actual
// click handling (look up or create the actress) is wired up by a single
// delegated listener in src/actresses/client.js — this only builds markup.
function renderCastLinks(castValue) {
  if (!castValue) return "";
  return castValue
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((name) => {
      const lookupName = stripCastAnnotation(name);
      return `<a href="#" class="cast-link" data-action="cast-link" data-actress-name="${esc(lookupName)}">${esc(name)}</a>`;
    })
    .join(", ");
}

// --- Actress filtering shared across Results / Downloaded tabs ---
// `actressItems` (the Actress table cache) is declared in src/actresses/client.js,
// which loads after this file in the bundle — safe to reference here since
// these are only called from event handlers, well after the whole script
// (and its `let actressItems = []` + loadActresses() call) has run.

function castHaystack(item) {
  return ((item.title || "") + " " + stripCastAnnotation(item.starring || "")).toLowerCase();
}

function actressNamesFor(actress) {
  return [actress.name, ...(actress.otherNames || [])].filter(Boolean);
}

// True if any favorited actress (starred in the Actress tab) appears in the
// item's title/cast text.
function matchesFavActress(item) {
  const items = typeof actressItems !== "undefined" ? actressItems : [];
  const favs = items.filter((a) => a.isFavorite);
  if (!favs.length) return false;
  const hay = castHaystack(item);
  return favs.some((a) => actressNamesFor(a).some((n) => hay.includes(n.toLowerCase())));
}

// filterValue is the raw <select> value: "" (all), "fav", or "actress:<id>".
function matchesActressFilter(item, filterValue) {
  if (!filterValue) return true;
  if (filterValue === "fav") return matchesFavActress(item);
  if (filterValue.startsWith("actress:")) {
    const id = parseInt(filterValue.slice("actress:".length), 10);
    const items = typeof actressItems !== "undefined" ? actressItems : [];
    const actress = items.find((a) => a.id === id);
    if (!actress) return false;
    const hay = castHaystack(item);
    return actressNamesFor(actress).some((n) => hay.includes(n.toLowerCase()));
  }
  return false;
}

// Fills the Results/Downloaded "filter by actress" selects with one option
// per known actress (by primary name), keeping the static "All"/"★ Fav"
// options in place. Called once actressItems is (re)loaded.
function populateActressFilterOptions() {
  const selects = [document.getElementById("filter-actress"), document.getElementById("downloaded-filter-actress")];
  const items = typeof actressItems !== "undefined" ? actressItems : [];
  selects.forEach((select) => {
    if (!select) return;
    const previousValue = select.value;
    while (select.options.length > 2) select.remove(2);
    items.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = `actress:${a.id}`;
      opt.textContent = a.name;
      select.appendChild(opt);
    });
    if (Array.from(select.options).some((o) => o.value === previousValue)) {
      select.value = previousValue;
    }
  });
}

function showStatus(el, msg, isError) {
  el.textContent = msg;
  el.className = "status-msg " + (isError ? "error" : "success");
  setTimeout(() => {
    el.textContent = "";
    el.className = "status-msg";
  }, 3000);
}

