const btnRefreshResults = document.getElementById("btn-refresh-results");
const resultCount = document.getElementById("results-count");
const searchInput = document.getElementById("search-input");
const filterForum = document.getElementById("filter-forum");
const filterActress = document.getElementById("filter-actress");
const filterHidden = document.getElementById("filter-hidden");
const resultsContainer = document.getElementById("results-container");
const resultsFilterTags = document.getElementById("results-filter-tags");
const resultsFilterTagsWrap = document.getElementById("results-filter-tags-wrap");
const resultsClearTagsBtn = document.getElementById("results-clear-tags");
// --- Results ---

let allResultsKnownTags = []; // cached tag vocabulary (shared with Downloaded tab)

// Toolbar tags filter — shared control (see src/core/ui/tags.js) so the
// Results tab behaves identically to the Downloaded tab.
const resultsTagFilter = createTagFilterControl({
  selectEl: resultsFilterTags,
  wrapEl: resultsFilterTagsWrap,
  clearBtnEl: resultsClearTagsBtn,
  onChange: () => loadResults(),
});

async function loadAllResultsKnownTags() {
  try {
    const res = await fetch("/api/results/tags");
    if (!res.ok) return;
    const data = await res.json();
    const tags = Array.isArray(data.tags) ? data.tags : [];
    allResultsKnownTags = tags.map((t) => (typeof t === "string" ? { name: t, color: null } : { name: String(t.name || ""), color: t.color || null }));
    resultsTagFilter.setKnownTags(allResultsKnownTags);
  } catch (err) {
    console.error("Failed to load known tags:", err);
  }
}

async function persistResultTags(topicUrl, tags) {
  try {
    const res = await fetch("/api/results/tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicUrl, tags }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.tags) ? data.tags : [];
  } catch (err) {
    console.error("Failed to update tags:", err);
    return null;
  }
}

// Remove a single tag from a card in-place without a full re-fetch, and
// roll back on failure.
async function removeTagFromResultCard(card, tagName) {
  if (!card) return;
  const topicUrl = card.dataset.url;
  if (!topicUrl) return;
  const current = decodeTagsDataAttr(card.dataset.tags);
  const next = current.filter((t) => tagNameLower(t) !== tagName.toLowerCase());
  if (next.length === current.length) return;
  const chip = card.querySelector(`.tag-chip[data-tag-name="${cssEscape(tagName)}"]`);
  if (chip) chip.style.opacity = "0.4";
  const updated = await persistResultTags(topicUrl, next);
  if (updated === null) {
    if (chip) chip.style.opacity = "1";
    return;
  }
  card.dataset.tags = JSON.stringify(updated);
  if (chip) chip.remove();
  loadAllResultsKnownTags();
  // Refresh if the removed tag was part of an active filter — the item may
  // no longer satisfy the filter and should disappear from the view.
  if (resultsTagFilter.getActiveFilters().length) loadResults();
}

async function loadForums() {
  try {
    const res = await fetch("/api/forums");
    if (!res.ok) return;
    const forums = await res.json();
    // Keep first "All forums" option
    while (filterForum.options.length > 1) filterForum.remove(1);
    forums.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f;
      filterForum.appendChild(opt);
    });
  } catch {}
}

async function loadResults() {
  try {
    const q = searchInput.value.trim();
    const forum = filterForum.value;
    const activeTagFilters = resultsTagFilter.getActiveFilters();
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (forum) params.set("forum", forum);
    if (activeTagFilters.length) params.set("tags", activeTagFilters.join(","));
    const qs = params.toString();
    const url = qs ? `/api/results?${qs}` : "/api/results";
    const res = await fetch(url);
    if (!res.ok) {
      resultsContainer.innerHTML = '<div class="empty-state">No results yet. Run a crawl first.</div>';
      resultCount.textContent = "";
      return;
    }
    const data = await res.json();
    await loadHiddenSet(data);
    const filterMode = filterHidden.value; // "exclude" or "all"
    const actressMode = filterActress.value; // "", "fav", or "actress:<id>"

    let filtered = data;
    if (filterMode === "exclude") {
      filtered = filtered.filter((t) => !hiddenSet.has(t.topicUrl));
    }
    if (actressMode) {
      filtered = filtered.filter((t) => matchesActressFilter(t, actressMode));
    }

    resultCount.textContent = `${filtered.length} topics` + (q ? ` (search: "${q}")` : " in DB");
    if (forum) resultCount.textContent += ` — ${forum}`;
    if (actressMode === "fav") {
      resultCount.textContent += ` — ★ fav actresses`;
    } else if (actressMode.startsWith("actress:")) {
      const actress = actressItems.find((a) => a.id === parseInt(actressMode.slice("actress:".length), 10));
      if (actress) resultCount.textContent += ` — 🎭 ${actress.name}`;
    }
    if (activeTagFilters.length) resultCount.textContent += ` — 🏷️ ${activeTagFilters.join(", ")}`;
    if (filtered.length === 0) {
      resultsContainer.innerHTML = '<div class="empty-state">No topics found.</div>';
      return;
    }
    resultsContainer.innerHTML = filtered
      .map(
        (t) => {
          const isHidden = hiddenSet.has(t.topicUrl);
          const isFav = matchesFavActress(t);
          const extraClass = isFav ? " result-card--fav" : "";
          const tagsData = encodeTagsDataAttr(t.tags || []);
          const tagsHtml = renderTagChips(t.tags || []);
          return `
      <div class="result-card${isHidden ? " result-card--hidden" : ""}${extraClass}" data-url="${esc(t.topicUrl)}" data-title="${esc(t.title)}" data-starring="${esc(t.starring || "")}" data-production-date="${esc(t.productionDate || "")}" data-duration="${esc(t.duration || "")}" data-size="${esc(t.size || "")}" data-post-image="${esc(t.postImage || "")}" data-tags="${tagsData}">
        ${t.postImage ? `<img class="result-thumb" src="${esc(t.postImage)}" alt="" loading="lazy" onerror="this.style.display='none'" />` : ""}
        <div class="result-info">
          <div class="result-title"><a href="${esc(t.topicUrl)}" target="_blank">${isFav ? "★ " : ""}${esc(t.title)}</a></div>
          <div class="result-meta">
            ${t.sourceForum ? `<div class="result-meta-row result-meta-row--header"><span><span class="label">Forum:</span> <span class="value">${esc(t.sourceForum)}</span></span></div>` : ""}
            <div class="result-meta-row result-meta-row--details">
              ${t.starring ? `<span><span class="label">Cast:</span> <span class="value">${renderCastLinks(t.starring)}</span></span>` : ""}
              ${t.productionDate ? `<span><span class="label">Date:</span> <span class="value">${esc(t.productionDate)}</span></span>` : ""}
              ${t.duration ? `<span><span class="label">Duration:</span> <span class="value">${esc(t.duration)}</span></span>` : ""}
              ${t.size ? `<span><span class="label">Size:</span> <span class="value">${esc(t.size)}</span></span>` : ""}
            </div>
          </div>
          <div class="result-actions">
            <div class="result-actions-menu-wrapper">
              <button class="btn btn-small btn-menu-trigger" data-action="menu">⋯</button>
              <div class="popup-menu" data-popup-menu>
                <button class="popup-menu-item" data-action="refresh-details">🔄 Refresh details</button>
                <button class="popup-menu-item" data-action="edit">✏️ Edit</button>
                <button class="popup-menu-item danger" data-action="delete">🗑 Delete</button>
              </div>
            </div>
            ${t.torrentUrl ? `<a class="btn btn-small" href="${esc(t.torrentUrl)}" target="_blank">⬇ Torrent</a>` : ""}
            ${t.postImage ? `<button class="btn btn-small" data-action="screens">🖼 Screens</button>` : ""}
            <button class="btn btn-small btn-hide" data-action="toggle-hide">${isHidden ? "👁 Show" : "🙈 Hide"}</button>
          </div>
          <div class="item-tags" data-item-tags>
            ${tagsHtml}
            <button class="btn btn-small btn-tag-add" data-action="add-tag" title="Add or assign tag">+ Add tag</button>
          </div>
        </div>
      </div>`;
        },
      )
      .join("");
  } catch (err) {
    resultsContainer.innerHTML = `<div class="empty-state">Error: ${esc(err.message)}</div>`;
  }
}

btnRefreshResults.addEventListener("click", loadResults);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadResults();
});
filterForum.addEventListener("change", loadResults);
filterActress.addEventListener("change", loadResults);
filterHidden.addEventListener("change", loadResults);

// Event delegation for hide buttons
resultsContainer.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action='toggle-hide']");
  if (!btn) return;
  const card = btn.closest(".result-card");
  if (!card) return;
  const topicUrl = card.dataset.url;
  if (!topicUrl) return;

  const nowHidden = await toggleHidden(topicUrl);
  btn.textContent = nowHidden ? "👁 Show" : "🙈 Hide";

  // If in "exclude" mode, re-render to remove hidden cards immediately
  if (filterHidden.value === "exclude" && nowHidden) {
    loadResults();
  }
});

// Event delegation for "Screens" button — opens carousel
resultsContainer.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action='screens']");
  if (!btn) return;
  const card = btn.closest(".result-card");
  if (!card) return;
  const topicUrl = card.dataset.url;
  const title = card.dataset.title || "Images";
  if (!topicUrl) return;

  await openImageCarousel(topicUrl, title);
});

// Event delegation for "⋯" menu button — toggle popup menu
resultsContainer.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action='menu']");
  if (!btn) return;
  e.stopPropagation();
  // Close any other open menus
  document.querySelectorAll(".popup-menu.open").forEach((m) => m.classList.remove("open"));
  const menu = btn.parentElement.querySelector(".popup-menu");
  if (menu) menu.classList.toggle("open");
});

// Close popup menus when clicking anywhere else
document.addEventListener("click", () => {
  document.querySelectorAll(".popup-menu.open").forEach((m) => m.classList.remove("open"));
});

// Event delegation for popup menu items
resultsContainer.addEventListener("click", async (e) => {
  const item = e.target.closest(".popup-menu-item");
  if (!item) return;
  const action = item.dataset.action;
  const card = item.closest(".result-card");
  if (!card) return;
  const topicUrl = card.dataset.url;
  const title = card.dataset.title || "";
  if (!topicUrl) return;

  // Close the menu
  item.closest(".popup-menu")?.classList.remove("open");

  if (action === "refresh-details") {
    await refreshTopicDetails(topicUrl, title, card);
  } else if (action === "delete") {
    await deleteTopicFromDb(topicUrl, card);
  } else if (action === "edit") {
    openResultsEditModal(card);
  }
});

// Event delegation for "Add tag" / "remove tag" — uses the shared Add Tag
// modal (see src/core/ui/tags.js), targeting a topic by its topicUrl.
resultsContainer.addEventListener("click", (e) => {
  const addTagBtn = e.target.closest("[data-action='add-tag']");
  if (addTagBtn) {
    const card = addTagBtn.closest(".result-card");
    const topicUrl = card.dataset.url;
    if (!topicUrl) return;
    TagModal.open({
      key: topicUrl,
      tags: decodeTagsDataAttr(card.dataset.tags),
      knownTags: allResultsKnownTags,
      persist: (nextTags) => persistResultTags(topicUrl, nextTags),
      onSaved: (updatedTags) => {
        card.dataset.tags = JSON.stringify(updatedTags);
        const wrap = card.querySelector("[data-item-tags]");
        if (wrap) {
          wrap.innerHTML = `${renderTagChips(updatedTags)}<button class="btn btn-small btn-tag-add" data-action="add-tag" title="Add or assign tag">+ Add tag</button>`;
        }
        loadAllResultsKnownTags();
        if (resultsTagFilter.getActiveFilters().length) loadResults();
      },
    });
    return;
  }

  const removeTagBtn = e.target.closest("[data-action='remove-tag']");
  if (removeTagBtn) {
    e.stopPropagation();
    const card = removeTagBtn.closest(".result-card");
    const tagName = removeTagBtn.dataset.tagName || "";
    if (!tagName) return;
    removeTagFromResultCard(card, tagName);
  }
});

async function refreshTopicDetails(topicUrl, title, card) {
  if (!confirm(`Refresh details for "${title}"?`)) return;

  try {
    const res = await fetch("/api/results/refresh-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicUrl }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = JSON.parse(line.slice(6));
        if (data.phase === "done") {
          // Update the card's meta fields in-place
          const infoDiv = card.querySelector(".result-info");
          if (infoDiv && data.data) {
            const metaDiv = infoDiv.querySelector(".result-meta");
            if (metaDiv) {
              const d = data.details;
              // Update or add starring
              updateMetaField(metaDiv, "Cast:", d.starring);
              // Update or add productionDate
              updateMetaField(metaDiv, "Date:", d.productionDate);
              // Update or add duration
              updateMetaField(metaDiv, "Duration:", d.duration);
              // Size is preserved automatically since we don't touch it
            }
            // Update postImage if it changed
            if (data.data.postImage) {
              const thumb = card.querySelector(".result-thumb");
              if (thumb) {
                thumb.src = data.data.postImage;
              } else if (!card.querySelector(".result-thumb")) {
                // Add a thumbnail if there wasn't one
                const img = document.createElement("img");
                img.className = "result-thumb";
                img.src = data.data.postImage;
                img.alt = "";
                img.loading = "lazy";
                img.onerror = function() { this.style.display = "none"; };
                card.insertBefore(img, card.querySelector(".result-info"));
              }
            }
          }
        } else if (data.phase === "error") {
          alert(`Error: ${data.message}`);
        }
      }
    }
  } catch (err) {
    alert(`Failed to reload details: ${err.message}`);
  }
}

function updateMetaField(metaDiv, label, value) {
  // Find existing span with this label
  const spans = metaDiv.querySelectorAll("span");
  let found = false;
  for (const span of spans) {
    const labelEl = span.querySelector(".label");
    if (labelEl && labelEl.textContent === label) {
      if (value) {
        const valEl = span.querySelector(".value");
        if (valEl) {
          // Cast values are rendered as clickable actress links; everything
          // else is plain text.
          if (label === "Cast:") valEl.innerHTML = renderCastLinks(value);
          else valEl.textContent = value;
        }
        found = true;
      } else {
        // Remove the span if value is now null
        span.remove();
        found = true;
      }
      break;
    }
  }
  // If not found and value exists, add it at the correct position
  if (!found && value) {
    const newSpan = document.createElement("span");
    const valueHtml = label === "Cast:" ? renderCastLinks(value) : esc(value);
    newSpan.innerHTML = `<span class="label">${label}</span> <span class="value">${valueHtml}</span>`;
    appendMetaField(metaDiv, newSpan, label);
  }
}

// --- Results: Edit modal ---

const resultsEditModal = document.getElementById("results-edit-modal");
const resultsEditUrlInput = document.getElementById("results-edit-url");
const resultsEditTopicUrlInput = document.getElementById("results-edit-topic-url");
const resultsEditPostImageInput = document.getElementById("results-edit-post-image");
const resultsEditTitleInput = document.getElementById("results-edit-title");
const resultsEditStarringInput = document.getElementById("results-edit-starring");
const resultsEditDateInput = document.getElementById("results-edit-production-date");
const resultsEditDurationInput = document.getElementById("results-edit-duration");
const resultsEditSizeInput = document.getElementById("results-edit-size");
const resultsEditStatus = document.getElementById("results-edit-status");
const resultsEditSaveBtn = document.getElementById("results-edit-save");
const resultsEditCancelBtn = document.getElementById("results-edit-cancel");
const resultsEditCloseBtn = document.getElementById("results-edit-close");

function openResultsEditModal(card) {
  if (!card) return;
  resultsEditUrlInput.value = card.dataset.url || "";
  resultsEditTopicUrlInput.value = card.dataset.url || "";
  resultsEditPostImageInput.value = card.dataset.postImage || "";
  resultsEditTitleInput.value = card.dataset.title || "";
  resultsEditStarringInput.value = card.dataset.starring || "";
  resultsEditDateInput.value = card.dataset["productionDate"] || "";
  resultsEditDurationInput.value = card.dataset.duration || "";
  resultsEditSizeInput.value = card.dataset.size || "";
  resultsEditStatus.textContent = "";
  resultsEditStatus.className = "status-msg";
  resultsEditSaveBtn.disabled = false;
  resultsEditCancelBtn.disabled = false;
  resultsEditModal.hidden = false;
}

function closeResultsEditModal() {
  resultsEditModal.hidden = true;
}

resultsEditCloseBtn.addEventListener("click", closeResultsEditModal);
resultsEditCancelBtn.addEventListener("click", closeResultsEditModal);
resultsEditModal.addEventListener("click", (e) => {
  if (e.target === resultsEditModal) closeResultsEditModal();
});

resultsEditSaveBtn.addEventListener("click", async () => {
  const topicUrl = resultsEditUrlInput.value;
  if (!topicUrl) return;

  const fields = { topicUrl };
  const textInputs = [
    ["title", resultsEditTitleInput],
    ["starring", resultsEditStarringInput],
    ["productionDate", resultsEditDateInput],
    ["duration", resultsEditDurationInput],
    ["size", resultsEditSizeInput],
    ["postImage", resultsEditPostImageInput],
  ];
  for (const [key, input] of textInputs) {
    fields[key] = input.value.trim() || null;
  }

  resultsEditSaveBtn.disabled = true;
  resultsEditCancelBtn.disabled = true;
  resultsEditStatus.textContent = "Saving...";
  resultsEditStatus.className = "status-msg";

  try {
    const res = await fetch("/api/results/item", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    if (data.item) applyResultsEditToCard(topicUrl, data.item);
    closeResultsEditModal();
  } catch (err) {
    resultsEditStatus.textContent = `Error: ${err.message}`;
    resultsEditStatus.className = "status-msg error";
  } finally {
    resultsEditSaveBtn.disabled = false;
    resultsEditCancelBtn.disabled = false;
  }
});

// Patch a result card in-place after a successful edit save, reusing the
// same meta-field helpers as refreshTopicDetails().
function applyResultsEditToCard(topicUrl, item) {
  const card = resultsContainer.querySelector(`.result-card[data-url="${cssEscape(topicUrl)}"]`);
  if (!card) return;

  card.dataset.title = item.title || "";
  card.dataset.starring = item.starring || "";
  card.dataset["productionDate"] = item.productionDate || "";
  card.dataset.duration = item.duration || "";
  card.dataset.size = item.size || "";
  card.dataset.postImage = item.postImage || "";

  const titleLink = card.querySelector(".result-title a");
  if (titleLink) {
    const wasFav = titleLink.textContent.startsWith("★ ");
    titleLink.textContent = (wasFav ? "★ " : "") + item.title;
  }

  const metaDiv = card.querySelector(".result-meta");
  if (metaDiv) {
    updateMetaField(metaDiv, "Cast:", item.starring);
    updateMetaField(metaDiv, "Date:", item.productionDate);
    updateMetaField(metaDiv, "Duration:", item.duration);
    updateMetaField(metaDiv, "Size:", item.size);
  }

  let thumb = card.querySelector(".result-thumb");
  if (item.postImage) {
    if (thumb) {
      thumb.src = item.postImage;
    } else {
      thumb = document.createElement("img");
      thumb.className = "result-thumb";
      thumb.alt = "";
      thumb.loading = "lazy";
      thumb.onerror = function () { this.style.display = "none"; };
      thumb.src = item.postImage;
      card.insertBefore(thumb, card.querySelector(".result-info"));
    }
  } else if (thumb) {
    thumb.remove();
  }
}

async function deleteTopicFromDb(topicUrl, card) {
  if (!confirm(`Delete this topic from the database? This cannot be undone.`)) return;

  try {
    const res = await fetch(`/api/results/item?url=${encodeURIComponent(topicUrl)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (data.deleted) {
      // Animate removal
      card.style.transition = "opacity 0.3s, transform 0.3s";
      card.style.opacity = "0";
      card.style.transform = "translateX(-20px)";
      setTimeout(() => card.remove(), 300);
      // Update count
      const countEl = document.getElementById("results-count");
      if (countEl) {
        const match = countEl.textContent.match(/^(\d+) topics/);
        if (match) {
          const newCount = parseInt(match[1], 10) - 1;
          countEl.textContent = countEl.textContent.replace(/^\d+ topics/, `${newCount} topics`);
        }
      }
    } else {
      alert("Topic not found in database.");
    }
  } catch (err) {
    alert(`Failed to delete: ${err.message}`);
  }
}

