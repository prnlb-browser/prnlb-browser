// --- Actress Tab ---

const actressContainer = document.getElementById("actress-container");
const actressCountEl = document.getElementById("actress-count");
const actressSearchInput = document.getElementById("actress-search-input");
const btnNewActress = document.getElementById("btn-new-actress");

let actressItems = []; // cached list of all actresses

// The cached image filename is a hash of the actress id, not the image
// content, so it stays identical across a lookup/edit that swaps in a
// different photo. Track a per-id cache-bust token, bumped whenever we know
// that actress's image file was just replaced, so re-rendered tiles fetch
// the new bytes instead of the browser's 24h-cached copy of the old ones.
const actressImageCacheBust = new Map();

function buildActressImageSrc(cachedFileName, id) {
  if (!cachedFileName) return null;
  const src = `/api/actresses/images/${encodeURIComponent(cachedFileName)}`;
  const bust = actressImageCacheBust.get(id);
  return bust ? `${src}?t=${bust}` : src;
}

async function loadActresses() {
  try {
    const res = await fetch("/api/actresses");
    if (!res.ok) return;
    actressItems = await res.json();
    renderActressTiles();
    populateActressFilterOptions();
  } catch (err) {
    console.error("Failed to load actresses:", err);
  }
}

function renderActressTiles() {
  const q = actressSearchInput ? actressSearchInput.value.trim().toLowerCase() : "";
  let visible = actressItems;
  if (q) {
    visible = visible.filter(
      (a) => a.name.toLowerCase().includes(q) || (a.otherNames || []).some((n) => n.toLowerCase().includes(q)),
    );
  }

  actressCountEl.textContent = visible.length ? `${visible.length} actress(es)` : "";

  if (actressItems.length === 0) {
    actressContainer.innerHTML = '<div class="empty-state">No actresses yet. Click "New actress" to add one.</div>';
    return;
  }
  if (visible.length === 0) {
    actressContainer.innerHTML = '<div class="empty-state">No actresses match the current search.</div>';
    return;
  }

  actressContainer.innerHTML = visible
    .map((a) => {
      const src = buildActressImageSrc(a.cachedImage, a.id);
      return `
      <div class="actress-tile" data-id="${a.id}">
        <div class="actress-tile-thumb-wrap">
          ${src
            ? `<img class="actress-tile-thumb" src="${src}" alt="" loading="lazy" onerror="this.style.display='none'" />`
            : `<div class="actress-tile-placeholder">🎭</div>`}
          <button class="actress-tile-fav${a.isFavorite ? " actress-tile-fav--active" : ""}" data-action="toggle-favorite" data-id="${a.id}" title="${a.isFavorite ? "Remove from favorites" : "Add to favorites"}" type="button">${a.isFavorite ? "★" : "☆"}</button>
        </div>
        <div class="actress-tile-name">${esc(a.name)}</div>
      </div>`;
    })
    .join("");
}

async function toggleActressFavorite(id) {
  try {
    const res = await fetch("/api/actresses/item/favorite", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const item = actressItems.find((a) => a.id === id);
    if (item) item.isFavorite = data.isFavorite;
    renderActressTiles();
  } catch (err) {
    console.error("Failed to toggle favorite:", err);
  }
}

actressContainer.addEventListener("click", (e) => {
  const favBtn = e.target.closest("[data-action='toggle-favorite']");
  if (favBtn) {
    e.stopPropagation();
    toggleActressFavorite(parseInt(favBtn.dataset.id, 10));
    return;
  }
  const tile = e.target.closest(".actress-tile");
  if (!tile) return;
  const id = parseInt(tile.dataset.id, 10);
  const actress = actressItems.find((a) => a.id === id);
  if (actress) openActressModal(actress);
});

if (actressSearchInput) {
  let actressSearchDebounce = null;
  actressSearchInput.addEventListener("input", () => {
    if (actressSearchDebounce) clearTimeout(actressSearchDebounce);
    actressSearchDebounce = setTimeout(renderActressTiles, 150);
  });
}

btnNewActress.addEventListener("click", () => openActressModal(null));

// --- Actress: New/Edit modal ---

const actressModal = document.getElementById("actress-modal");
const actressModalTitle = document.getElementById("actress-modal-title");
const actressIdInput = document.getElementById("actress-id");
const actressNameInput = document.getElementById("actress-name");
const actressOtherNamesList = document.getElementById("actress-other-names-list");
const actressOtherNameInput = document.getElementById("actress-other-name-input");
const actressAddOtherNameBtn = document.getElementById("actress-add-other-name");
const actressImageWrap = document.getElementById("actress-image-wrap");
const actressImageImg = document.getElementById("actress-image-img");
const actressImagePlaceholder = document.getElementById("actress-image-placeholder");
const actressImageUrlInput = document.getElementById("actress-image-url");
const actressApplyImageBtn = document.getElementById("actress-apply-image");
const actressClearImageBtn = document.getElementById("actress-clear-image");
const actressImageStatus = document.getElementById("actress-image-status");
const actressModalStatus = document.getElementById("actress-modal-status");
const actressSaveBtn = document.getElementById("actress-save");
const actressCancelBtn = document.getElementById("actress-cancel");
const actressCloseBtn = document.getElementById("actress-modal-close");
const actressDeleteBtn = document.getElementById("actress-delete");

let actressModalId = null; // null while the actress hasn't been persisted yet
let actressModalOtherNames = [];
let actressModalCachedImage = null;
let actressModalPostImage = null; // source URL behind the current cachedImage
let actressModalPendingImageUrl = null; // remote URL previewed from web search, not yet resolved/downloaded
let actressModalWasNewRecord = false; // true if this session's record was auto-created (no id when opened)
let actressModalOriginalPostImage = null; // server postImage at open time, to revert to on cancel

function renderActressOtherNames() {
  actressOtherNamesList.innerHTML = "";
  actressModalOtherNames.forEach((name, i) => {
    const div = document.createElement("div");
    div.className = "fav-actress-entry";
    div.innerHTML = `<span>${esc(name)}</span><button class="btn btn-small btn-danger" data-remove-other-name="${i}" type="button">✕</button>`;
    div.querySelector("[data-remove-other-name]").addEventListener("click", () => {
      actressModalOtherNames.splice(i, 1);
      renderActressOtherNames();
    });
    actressOtherNamesList.appendChild(div);
  });
}

actressAddOtherNameBtn.addEventListener("click", () => {
  const name = actressOtherNameInput.value.trim();
  if (!name) return;
  if (actressModalOtherNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
    actressOtherNameInput.value = "";
    return;
  }
  actressModalOtherNames.push(name);
  actressOtherNameInput.value = "";
  renderActressOtherNames();
});
actressOtherNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    actressAddOtherNameBtn.click();
  }
});

function updateActressImagePreview() {
  // A web search result that hasn't been resolved/downloaded yet takes
  // priority: preview it straight from the internet until Save or
  // Download/Resolve pulls down a local copy.
  if (actressModalPendingImageUrl) {
    actressImageImg.src = actressModalPendingImageUrl;
    actressImageImg.style.display = "block";
    actressImagePlaceholder.style.display = "none";
    return;
  }
  const src = buildActressImageSrc(actressModalCachedImage);
  if (src) {
    // The cached filename is a hash of the actress id, not the image
    // content, so it can stay identical across a lookup that replaces the
    // picture. Bust the cache (both the <img> no-op-on-same-src behavior
    // and the server's Cache-Control header) so the new image actually shows.
    actressImageImg.src = `${src}?t=${Date.now()}`;
    actressImageImg.style.display = "block";
    actressImagePlaceholder.style.display = "none";
  } else {
    actressImageImg.removeAttribute("src");
    actressImageImg.style.display = "none";
    actressImagePlaceholder.style.display = "block";
  }
}

// Opens the modal for a known actress (edit), or a blank/prefilled draft
// (create) when `actress` is null. `prefillName` seeds the Name field when
// creating from an unresolved Cast link.
function openActressModal(actress, prefillName) {
  actressModalId = actress ? actress.id : null;
  actressModalOtherNames = actress ? actress.otherNames.slice() : [];
  actressModalCachedImage = actress ? actress.cachedImage : null;
  actressModalPostImage = actress ? actress.postImage : null;
  actressModalPendingImageUrl = null;
  actressModalWasNewRecord = !actress;
  actressModalOriginalPostImage = actress ? actress.postImage : null;

  actressIdInput.value = actressModalId ? String(actressModalId) : "";
  actressModalTitle.textContent = actress ? "🎭 Actress" : "🎭 New actress";
  actressDeleteBtn.hidden = !actress;
  actressNameInput.value = actress ? actress.name : prefillName || "";
  actressImageUrlInput.value = "";
  renderActressOtherNames();
  updateActressImagePreview();
  actressImageStatus.textContent = "";
  actressImageStatus.className = "status-msg";
  actressModalStatus.textContent = "";
  actressModalStatus.className = "status-msg";
  actressSaveBtn.disabled = false;
  actressCancelBtn.disabled = false;
  actressModal.hidden = false;
  setTimeout(() => actressNameInput.focus(), 0);
}

function closeActressModal() {
  actressModal.hidden = true;
  actressModalId = null;
  actressModalOtherNames = [];
  actressModalCachedImage = null;
  actressModalPostImage = null;
  actressModalPendingImageUrl = null;
  actressModalWasNewRecord = false;
  actressModalOriginalPostImage = null;
}

// Web search / "Apply URL" / "Clear" all PATCH the record straight away
// (see applyActressImageUrl / actressClearImageBtn below), instead of
// waiting for Save. So cancelling the dialog has to actively undo that:
// either delete the record if it only exists because this session
// auto-created it, or revert its image back to what it was when opened.
// Note: the cached filename is a hash of the actress id, so it stays
// identical across a lookup that swaps in a different photo — compare
// postImage (the source URL) instead, since that's what actually changes.
async function discardActressModalChanges() {
  if (actressModalWasNewRecord && actressModalId) {
    try {
      await fetch(`/api/actresses/item?id=${actressModalId}`, { method: "DELETE" });
    } catch {
      // best-effort cleanup; nothing more we can do here
    }
    await loadActresses();
  } else if (actressModalId && actressModalPostImage !== actressModalOriginalPostImage) {
    try {
      await fetch("/api/actresses/item", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: actressModalId, postImageUrl: actressModalOriginalPostImage }),
      });
      actressImageCacheBust.set(actressModalId, Date.now());
    } catch {
      // best-effort revert; nothing more we can do here
    }
    await loadActresses();
  }
  closeActressModal();
}

actressCloseBtn.addEventListener("click", discardActressModalChanges);
actressCancelBtn.addEventListener("click", discardActressModalChanges);
actressModal.addEventListener("click", (e) => {
  if (e.target === actressModal) discardActressModalChanges();
});

async function createActressRecord(name, otherNames, postImageUrl) {
  const body = { name, otherNames };
  if (postImageUrl) body.postImageUrl = postImageUrl;
  const res = await fetch("/api/actresses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return await res.json();
}

async function applyActressImageUrl(url) {
  if (!url) {
    actressImageStatus.textContent = "Enter a URL first";
    actressImageStatus.className = "status-msg error";
    return;
  }
  const name = actressNameInput.value.trim();
  if (!name) {
    actressImageStatus.textContent = "Enter a name first";
    actressImageStatus.className = "status-msg error";
    return;
  }

  actressImageStatus.textContent = "Resolving & downloading...";
  actressImageStatus.className = "status-msg";
  actressApplyImageBtn.disabled = true;
  actressClearImageBtn.disabled = true;
  try {
    if (!actressModalId) {
      // Not yet persisted — create the bare record now so the image PATCH
      // below has an id to attach to, then switch this dialog into edit mode.
      const created = await createActressRecord(name, actressModalOtherNames);
      if (!created) throw new Error("Failed to create actress");
      actressModalId = created.id;
      actressIdInput.value = String(actressModalId);
      actressModalTitle.textContent = "🎭 Actress";
      actressDeleteBtn.hidden = false;
    }
    const res = await fetch("/api/actresses/item", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: actressModalId, postImageUrl: url }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    actressModalCachedImage = data.cachedImage || null;
    actressModalPostImage = data.postImage || null;
    actressModalPendingImageUrl = null; // now backed by a local cached copy
    actressImageCacheBust.set(actressModalId, Date.now());
    updateActressImagePreview();
    actressImageStatus.textContent = actressModalCachedImage ? "✅ Image updated" : "⚠️ Couldn't resolve — original kept";
    actressImageStatus.className = "status-msg " + (actressModalCachedImage ? "success" : "error");
    await loadActresses();
  } catch (err) {
    actressImageStatus.textContent = `Error: ${err.message}`;
    actressImageStatus.className = "status-msg error";
  } finally {
    actressApplyImageBtn.disabled = false;
    actressClearImageBtn.disabled = false;
  }
}

actressApplyImageBtn.addEventListener("click", () => applyActressImageUrl(actressImageUrlInput.value.trim()));

actressClearImageBtn.addEventListener("click", async () => {
  actressImageUrlInput.value = "";
  actressModalPendingImageUrl = null;
  if (!actressModalId) {
    actressModalCachedImage = null;
    actressModalPostImage = null;
    updateActressImagePreview();
    return;
  }
  try {
    const res = await fetch("/api/actresses/item", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: actressModalId, postImageUrl: null }),
    });
    if (!res.ok) throw new Error("Failed to clear image");
    actressModalCachedImage = null;
    actressModalPostImage = null;
    actressImageCacheBust.set(actressModalId, Date.now());
    updateActressImagePreview();
    actressImageStatus.textContent = "Image cleared";
    actressImageStatus.className = "status-msg success";
    await loadActresses();
  } catch (err) {
    actressImageStatus.textContent = `Error: ${err.message}`;
    actressImageStatus.className = "status-msg error";
  }
});

actressSaveBtn.addEventListener("click", async () => {
  const name = actressNameInput.value.trim();
  if (!name) {
    actressModalStatus.textContent = "Name is required";
    actressModalStatus.className = "status-msg error";
    return;
  }

  actressSaveBtn.disabled = true;
  actressCancelBtn.disabled = true;
  actressModalStatus.textContent = "Saving...";
  actressModalStatus.className = "status-msg";
  try {
    if (actressModalId) {
      const fields = { id: actressModalId, name, otherNames: actressModalOtherNames };
      // A web-search photo is only previewed from the internet until now —
      // saving is what actually resolves and downloads a local copy of it.
      if (actressModalPendingImageUrl) fields.postImageUrl = actressModalPendingImageUrl;
      const res = await fetch("/api/actresses/item", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      if (fields.postImageUrl) actressImageCacheBust.set(actressModalId, Date.now());
    } else {
      const created = await createActressRecord(name, actressModalOtherNames, actressModalPendingImageUrl);
      if (!created) throw new Error("Save failed");
    }
    await loadActresses();
    closeActressModal();
  } catch (err) {
    actressModalStatus.textContent = `Error: ${err.message}`;
    actressModalStatus.className = "status-msg error";
  } finally {
    actressSaveBtn.disabled = false;
    actressCancelBtn.disabled = false;
  }
});

actressDeleteBtn.addEventListener("click", async () => {
  if (!actressModalId) return;
  if (!confirm("Delete this actress? This cannot be undone.")) return;
  try {
    const res = await fetch(`/api/actresses/item?id=${actressModalId}`, { method: "DELETE" });
    const data = await res.json();
    if (data.deleted) {
      await loadActresses();
      closeActressModal();
    }
  } catch (err) {
    actressModalStatus.textContent = `Error: ${err.message}`;
    actressModalStatus.className = "status-msg error";
  }
});

// --- Actress: External lookup (Boobpedia, IAFD, etc.) ---
// Each source gets its own globe button; clicking one queries that provider
// directly using the current Name field and applies the top match.

const actressLookupButtons = [
  { el: document.getElementById("actress-lookup-open"), provider: "boobpedia", label: "Boobpedia" },
  { el: document.getElementById("actress-lookup-open-iafd"), provider: "iafd", label: "IAFD" },
];

// Merges fetched details into the modal fields. The fetched name always
// becomes the primary name (even if it differs from what's currently in the
// field); the name it replaces is folded into "other names" alongside any
// aliases the provider returned, so no name is lost.
async function applyActressLookupDetails(details) {
  const previousName = actressNameInput.value.trim();
  if (details.name) actressNameInput.value = details.name;

  const namesToMerge = [...(details.otherNames || [])];
  if (previousName && details.name && previousName.toLowerCase() !== details.name.toLowerCase()) {
    namesToMerge.push(previousName);
  }
  for (const alias of namesToMerge) {
    const lower = alias.toLowerCase();
    if (lower === (details.name || "").toLowerCase()) continue;
    if (!actressModalOtherNames.some((n) => n.toLowerCase() === lower)) {
      actressModalOtherNames.push(alias);
    }
  }
  renderActressOtherNames();
  if (details.imageUrl) {
    // Preview straight from the source — don't download/persist yet. Save
    // or an explicit Download/Resolve click resolves it to a local copy.
    actressImageUrlInput.value = details.imageUrl;
    actressModalPendingImageUrl = details.imageUrl;
    updateActressImagePreview();
    actressImageStatus.textContent = "Previewing from the web — Save or Download/Resolve to store a local copy";
    actressImageStatus.className = "status-msg";
  }
}

async function runActressLookup(providerId, providerLabel) {
  const query = actressNameInput.value.trim();
  if (!query) {
    actressModalStatus.textContent = "Enter a name first";
    actressModalStatus.className = "status-msg error";
    return;
  }
  actressLookupButtons.forEach(({ el }) => { if (el) el.disabled = true; });
  actressModalStatus.textContent = `Fetching from ${providerLabel}...`;
  actressModalStatus.className = "status-msg";
  try {
    const searchRes = await fetch(
      `/api/actresses/lookup/search?provider=${providerId}&query=${encodeURIComponent(query)}`,
    );
    const searchData = await searchRes.json().catch(() => ({}));
    if (!searchRes.ok) throw new Error(searchData.error || "Search failed");
    const match = (searchData.matches || [])[0];
    if (!match) throw new Error("No matches found");

    const detailsRes = await fetch(
      `/api/actresses/lookup/details?provider=${providerId}&title=${encodeURIComponent(match.title)}`,
    );
    const details = await detailsRes.json().catch(() => ({}));
    if (!detailsRes.ok) throw new Error(details.error || "Failed to fetch details");

    await applyActressLookupDetails(details);
    const sourceLink = details.sourceUrl
      ? ` — <a href="${esc(details.sourceUrl)}" target="_blank" rel="noopener noreferrer">view page</a>`
      : "";
    actressModalStatus.innerHTML = `✅ Fetched from ${esc(providerLabel)}${sourceLink}`;
    actressModalStatus.className = "status-msg success";
  } catch (err) {
    actressModalStatus.textContent = `Error: ${err.message}`;
    actressModalStatus.className = "status-msg error";
  } finally {
    actressLookupButtons.forEach(({ el }) => { if (el) el.disabled = false; });
  }
}

actressLookupButtons.forEach(({ el, provider, label }) => {
  if (!el) return;
  el.addEventListener("click", () => runActressLookup(provider, label));
});

// --- Cast links: open (or create) the linked actress from any tab ---

function switchToActressTab() {
  const tabBtn = document.querySelector('.tab[data-tab="actress"]');
  const tabContent = document.getElementById("tab-actress");
  if (!tabBtn || !tabContent) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach((tc) => tc.classList.remove("active"));
  tabBtn.classList.add("active");
  tabContent.classList.add("active");
}

async function openActressByName(name) {
  switchToActressTab();
  await loadActresses();
  try {
    const res = await fetch(`/api/actresses/find?name=${encodeURIComponent(name)}`);
    const data = res.ok ? await res.json() : { actress: null };
    if (data.actress) {
      openActressModal(data.actress);
    } else {
      openActressModal(null, name);
    }
  } catch {
    openActressModal(null, name);
  }
}

document.addEventListener("click", (e) => {
  const link = e.target.closest("[data-action='cast-link']");
  if (!link) return;
  e.preventDefault();
  const name = link.dataset.actressName || "";
  if (!name) return;
  openActressByName(name);
});
