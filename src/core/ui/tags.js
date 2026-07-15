// --- Shared Tag UI helpers ---
// Both the Downloaded tab (items keyed by numeric id) and the Results tab
// (topics keyed by topicUrl) use the exact same tag model ({name, color}),
// the same color palette, and the same "Add tag" modal markup. This module
// holds everything that doesn't need to know which tab is calling it, plus
// a single shared modal controller parameterized by a small "target"
// descriptor supplied by whichever tab opens it.

// Normalize an arbitrary tag entry (string or {name, color}) to {name, color}.
function toTagObject(raw) {
  if (typeof raw === "string") return { name: raw, color: null };
  if (raw && typeof raw === "object") {
    return { name: String(raw.name || ""), color: typeof raw.color === "string" ? raw.color : null };
  }
  return null;
}

// Pull a tag's name (case-insensitive) for dedupe/comparison logic.
function tagNameLower(tag) {
  const obj = toTagObject(tag);
  return obj ? obj.name.toLowerCase() : "";
}

// Merge a {name, color} tag into an existing tag list. If the tag already
// exists (case-insensitive), the entry's color is preserved unless the new
// one carries a color and the existing one doesn't — first-encountered color wins.
function mergeTag(existingTags, newTag) {
  const out = Array.isArray(existingTags) ? existingTags.slice() : [];
  const lowerNew = newTag.name.toLowerCase();
  const idx = out.findIndex((t) => tagNameLower(t) === lowerNew);
  if (idx >= 0) {
    const existing = toTagObject(out[idx]);
    out[idx] = { name: existing.name || newTag.name, color: existing.color || newTag.color || null };
  } else {
    out.push({ name: newTag.name, color: newTag.color || null });
  }
  return out;
}

// Pick a black-or-white text color that contrasts with a given background.
// Uses the WCAG relative-luminance formula on the parsed color channels.
function contrastFg(hex) {
  const rgb = parseColor(hex);
  if (!rgb) return "#fff";
  const lum = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return lum > 0.55 ? "#111" : "#fff";
}

function parseColor(input) {
  if (!input) return null;
  const v = String(input).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) {
    const [r, g, b] = m[1].split("").map((c) => parseInt(c + c, 16));
    return { r, g, b };
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v);
  if (m) {
    return {
      r: parseInt(m[1].slice(0, 2), 16),
      g: parseInt(m[1].slice(2, 4), 16),
      b: parseInt(m[1].slice(4, 6), 16),
    };
  }
  m = /^rgba?\s*\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  if (m) {
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  }
  // Fallback: hand the value to the browser to canonicalize.
  if (typeof document !== "undefined" && document.body) {
    const probe = document.createElement("span");
    probe.style.color = v;
    const computed = getComputedStyle(probe).color;
    return parseColor(computed);
  }
  return null;
}

// Encode an array of tags as a JSON-escaped string suitable for an HTML
// attribute. Falls back to empty array on error.
function encodeTagsDataAttr(tags) {
  try {
    return esc(JSON.stringify(tags || []));
  } catch {
    return "[]";
  }
}

function decodeTagsDataAttr(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
  // Fallback: escape double quotes and backslashes for attribute selectors.
  return String(value).replace(/(["\\])/g, "\\$1");
}

// Render tag chips + a remove ("X") button per tag, for use inside item
// cards. Tags can be either a {name, color} object or a plain string
// (legacy/imported).
function renderTagChips(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return "";
  return tags.map((raw) => {
    const obj = toTagObject(raw);
    if (!obj || !obj.name) return "";
    const safe = esc(obj.name);
    const styleAttr = obj.color
      ? ` style="--tag-color:${esc(obj.color)};--tag-fg:${esc(contrastFg(obj.color))}"`
      : "";
    const colorClass = obj.color ? " tag-chip--colored" : "";
    return `<span class="tag-chip${colorClass}" data-tag-name="${safe}"${styleAttr}><span class="tag-chip-label">${safe}</span><button class="tag-chip-remove" data-action="remove-tag" data-tag-name="${safe}" title="Remove tag">×</button></span>`;
  }).join("");
}

// --- Tag filter dropdown (multi-select) ---
// Shared logic for the toolbar "tags filter" control that appears on both
// the Downloaded and Results tabs. Each tab owns its own <select>/wrap/clear
// button + its own list of active filters, but the rendering + selection
// bookkeeping is identical, so it lives here.
function createTagFilterControl({ selectEl, wrapEl, clearBtnEl, onChange }) {
  let activeFilters = []; // lower-cased tag names
  let knownTags = [];

  function syncClearButton() {
    if (clearBtnEl) clearBtnEl.hidden = activeFilters.length === 0;
  }

  function render() {
    if (!selectEl) return;
    const previous = new Set(activeFilters);
    selectEl.innerHTML = "";
    for (const tag of knownTags) {
      if (!tag.name) continue;
      const opt = document.createElement("option");
      opt.value = tag.name;
      opt.textContent = tag.color ? `● ${tag.name}` : tag.name;
      opt.dataset.color = tag.color || "";
      if (previous.has(tag.name.toLowerCase())) opt.selected = true;
      selectEl.appendChild(opt);
    }
    if (knownTags.length === 0) {
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "No tags yet";
      empty.disabled = true;
      empty.selected = true;
      selectEl.appendChild(empty);
    }
    if (wrapEl) wrapEl.hidden = false;
    syncClearButton();
  }

  if (selectEl) {
    selectEl.addEventListener("change", () => {
      const options = Array.from(selectEl.options);
      activeFilters = options
        .filter((opt) => opt.selected && opt.value !== "")
        .map((opt) => opt.value.trim().toLowerCase())
        .filter((t) => t.length > 0);
      syncClearButton();
      if (onChange) onChange(activeFilters);
    });
  }

  if (clearBtnEl) {
    clearBtnEl.addEventListener("click", () => {
      activeFilters = [];
      if (selectEl) {
        Array.from(selectEl.options).forEach((opt) => {
          opt.selected = false;
        });
      }
      syncClearButton();
      if (onChange) onChange(activeFilters);
    });
  }

  return {
    setKnownTags(tags) {
      knownTags = Array.isArray(tags) ? tags : [];
      render();
    },
    getActiveFilters() {
      return activeFilters;
    },
  };
}

// --- Shared color palette for the Add Tag modal ---

const TAG_COLOR_PRESETS = [
  null,           // "no color"
  "#ef4444",      // red
  "#f97316",      // orange
  "#f59e0b",      // amber
  "#eab308",      // yellow
  "#84cc16",      // lime
  "#22c55e",      // green
  "#10b981",      // emerald
  "#06b6d4",      // cyan
  "#3b82f6",      // blue
  "#6366f1",      // indigo
  "#a855f7",      // purple
  "#ec4899",      // pink
  "#f43f5e",      // rose
  "#94a3b8",      // slate
];

// --- Shared "Add Tag" modal controller ---
// A single modal instance lives in the DOM (#add-tag-modal). Whichever tab
// wants to tag an item calls TagModal.open(target), where target describes:
//   key         — identifier to display (numeric id or topicUrl)
//   tags        — the item's current tags ([{name, color}, ...])
//   knownTags   — suggestion pool (the shared tag vocabulary)
//   persist     — async (nextTags) => updatedTags|null — should PATCH the
//                 server and return the server's canonical tag list, or null
//                 on failure (the modal will leave the UI untouched then).
//   onSaved     — (updatedTags) => void — update the caller's in-memory
//                 cache and the item's card in the DOM.
const TagModal = (() => {
  const modal = document.getElementById("add-tag-modal");
  if (!modal) return { open() {}, close() {} };

  const idInput = document.getElementById("add-tag-id");
  const input = document.getElementById("add-tag-input");
  const suggestionsWrap = document.getElementById("add-tag-suggestions-wrap");
  const suggestionsEl = document.getElementById("add-tag-suggestions");
  const currentEl = document.getElementById("add-tag-current");
  const statusEl = document.getElementById("add-tag-status");
  const saveBtn = document.getElementById("add-tag-save");
  const cancelBtn = document.getElementById("add-tag-cancel");
  const closeBtn = document.getElementById("add-tag-close");
  const swatchesEl = document.getElementById("add-tag-swatches");
  const colorInputEl = document.getElementById("add-tag-color");
  const colorClearBtn = document.getElementById("add-tag-color-clear");
  const colorPreviewEl = document.getElementById("add-tag-color-preview");

  let target = null;
  let selectedColor = null;

  function updateColorPreview() {
    if (!colorPreviewEl) return;
    if (selectedColor) {
      colorPreviewEl.style.setProperty("--tag-color", selectedColor);
      colorPreviewEl.style.setProperty("--tag-fg", contrastFg(selectedColor));
      colorPreviewEl.classList.add("tag-chip--colored");
      colorPreviewEl.style.visibility = "visible";
    } else {
      colorPreviewEl.classList.remove("tag-chip--colored");
      colorPreviewEl.style.removeProperty("--tag-color");
      colorPreviewEl.style.removeProperty("--tag-fg");
      colorPreviewEl.style.visibility = "hidden";
    }
  }

  function renderColorPicker() {
    if (!swatchesEl) return;
    swatchesEl.innerHTML = "";
    selectedColor = null;
    for (const color of TAG_COLOR_PRESETS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tag-color-swatch" + (color ? "" : " tag-color-swatch--none");
      btn.dataset.color = color || "";
      btn.title = color ? `Use ${color}` : "No color";
      if (color) btn.style.background = color;
      if ((color || null) === selectedColor) btn.classList.add("tag-color-swatch--selected");
      btn.addEventListener("click", () => {
        selectedColor = color || null;
        if (colorInputEl && color) colorInputEl.value = color;
        swatchesEl.querySelectorAll(".tag-color-swatch").forEach((s) => {
          s.classList.toggle("tag-color-swatch--selected", (s.dataset.color || null) === selectedColor);
        });
        updateColorPreview();
      });
      swatchesEl.appendChild(btn);
    }
    if (colorInputEl) {
      colorInputEl.oninput = () => {
        selectedColor = colorInputEl.value || null;
        swatchesEl.querySelectorAll(".tag-color-swatch").forEach((s) => {
          s.classList.toggle("tag-color-swatch--selected", (s.dataset.color || null) === selectedColor);
        });
        updateColorPreview();
      };
    }
    if (colorClearBtn) {
      colorClearBtn.onclick = () => {
        selectedColor = null;
        swatchesEl.querySelectorAll(".tag-color-swatch").forEach((s) => {
          s.classList.toggle("tag-color-swatch--selected", (s.dataset.color || null) === selectedColor);
        });
        updateColorPreview();
      };
    }
    updateColorPreview();
  }

  function renderSuggestions() {
    if (!target) return;
    const lowerCurrent = new Set(target.tags.map((t) => tagNameLower(t)));
    const candidates = (target.knownTags || []).filter((t) => t.name && !lowerCurrent.has(t.name.toLowerCase()));
    if (candidates.length === 0) {
      suggestionsWrap.hidden = true;
      suggestionsEl.innerHTML = "";
      return;
    }
    suggestionsWrap.hidden = false;
    suggestionsEl.innerHTML = candidates.map((tag) => {
      const safe = esc(tag.name);
      const styleAttr = tag.color
        ? ` style="--tag-color:${esc(tag.color)};--tag-fg:${esc(contrastFg(tag.color))}"`
        : "";
      const colorClass = tag.color ? " tag-chip--colored" : "";
      return `<button class="tag-chip tag-chip--suggestion${colorClass}" data-suggestion="${safe}" type="button"${styleAttr}><span class="tag-chip-label">${safe}</span><span class="tag-chip-append" aria-hidden="true">+</span></button>`;
    }).join("");
  }

  function renderCurrent() {
    if (!target) return;
    if (!target.tags.length) {
      currentEl.innerHTML = '<span class="status-msg">No tags yet.</span>';
      return;
    }
    currentEl.innerHTML = target.tags.map((raw) => {
      const obj = toTagObject(raw);
      if (!obj || !obj.name) return "";
      const safe = esc(obj.name);
      const styleAttr = obj.color
        ? ` style="--tag-color:${esc(obj.color)};--tag-fg:${esc(contrastFg(obj.color))}"`
        : "";
      const colorClass = obj.color ? " tag-chip--colored" : "";
      return `<span class="tag-chip${colorClass}" data-tag-name="${safe}"${styleAttr}><span class="tag-chip-label">${safe}</span></span>`;
    }).join("");
  }

  function open(newTarget) {
    target = newTarget;
    idInput.value = String(target.key);
    input.value = "";
    statusEl.textContent = "";
    statusEl.className = "status-msg";
    renderColorPicker();
    renderCurrent();
    renderSuggestions();
    modal.hidden = false;
    setTimeout(() => input.focus(), 100);
  }

  function close() {
    modal.hidden = true;
    target = null;
    input.value = "";
    suggestionsWrap.hidden = true;
    suggestionsEl.innerHTML = "";
    currentEl.innerHTML = "";
  }

  async function assign(tagName, color) {
    if (!target) return null;
    const next = mergeTag(target.tags, { name: tagName, color: color || null });
    const updated = await target.persist(next);
    if (updated === null) return null;
    target.tags = updated;
    target.onSaved(updated);
    renderCurrent();
    renderSuggestions();
    return updated;
  }

  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveBtn.click();
    }
  });

  suggestionsEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-suggestion]");
    if (!btn || !target) return;
    const tagName = btn.dataset.suggestion || "";
    if (!tagName) return;
    btn.disabled = true;
    const known = (target.knownTags || []).find((t) => t.name.toLowerCase() === tagName.toLowerCase());
    const color = (known && known.color) || selectedColor;
    await assign(tagName, color);
    btn.disabled = false;
  });

  saveBtn.addEventListener("click", async () => {
    if (!target) return;
    const raw = input.value.trim();
    if (!raw) {
      statusEl.textContent = "Enter a tag name first";
      statusEl.className = "status-msg error";
      return;
    }
    const lowerCurrent = new Set(target.tags.map((t) => tagNameLower(t)));
    if (lowerCurrent.has(raw.toLowerCase())) {
      statusEl.textContent = `Tag "${raw}" is already on this item`;
      statusEl.className = "status-msg error";
      return;
    }
    saveBtn.disabled = true;
    statusEl.textContent = "Saving...";
    statusEl.className = "status-msg";
    const updated = await assign(raw, selectedColor);
    saveBtn.disabled = false;
    if (updated === null) return;
    input.value = "";
    statusEl.textContent = `Tag "${raw}" added`;
    statusEl.className = "status-msg success";
    setTimeout(() => {
      if (statusEl.textContent === `Tag "${raw}" added`) {
        statusEl.textContent = "";
        statusEl.className = "status-msg";
      }
    }, 1500);
  });

  return { open, close };
})();
