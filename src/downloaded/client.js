// --- Downloaded Tab ---

const folderPathInput = document.getElementById("folder-path");
const btnSelectFolder = document.getElementById("btn-select-folder");
const btnRefresh = document.getElementById("btn-refresh");
const downloadedStatus = document.getElementById("downloaded-status");
const downloadedProgress = document.getElementById("downloaded-progress");
const downloadedProgressBar = document.getElementById("downloaded-progress-bar");
const downloadedProgressLog = document.getElementById("downloaded-progress-log");
const downloadedContainer = document.getElementById("downloaded-container");
const downloadedCount = document.getElementById("downloaded-count");
const downloadedSearchInput = document.getElementById("downloaded-search-input");
const downloadedFilterActress = document.getElementById("downloaded-filter-actress");
const downloadedFilterTags = document.getElementById("downloaded-filter-tags");
const downloadedFilterTagsWrap = document.getElementById("downloaded-filter-tags-wrap");
const downloadedClearTagsBtn = document.getElementById("downloaded-clear-tags");
const downloadedSortBy = document.getElementById("downloaded-sort-by");
const downloadedSortDir = document.getElementById("downloaded-sort-dir");

let currentFolder = null; // currently selected folder path
let downloadedItems = []; // current downloaded items
let isScanning = false;
let allKnownTags = [];     // cached list of all tags across the library (shared with Results tab)

// Toolbar tags filter — shared control (see src/core/ui/tags.js) so the
// Downloaded and Results tabs behave identically.
const downloadedTagFilter = createTagFilterControl({
  selectEl: downloadedFilterTags,
  wrapEl: downloadedFilterTagsWrap,
  clearBtnEl: downloadedClearTagsBtn,
  onChange: () => {
    if (currentFolder) loadDownloadedItems();
  },
});

function isElectron() {
  return window.electronAPI && window.electronAPI.isElectron;
}

// Load saved folder from server (persisted in config.json)
async function loadSavedFolder() {
  try {
    const res = await fetch("/api/downloaded/folder");
    if (!res.ok) return;
    const { folderPath } = await res.json();
    if (folderPath) {
      folderPathInput.value = folderPath;
      currentFolder = folderPath;
      btnRefresh.disabled = false;
      // Populate the tag filter from the persisted database before loading
      // items so the toolbar is usable as soon as the tab is visible.
      loadAllKnownTags();
      loadDownloadedItems();
    }
  } catch {}
}
loadSavedFolder();

// Select folder button
btnSelectFolder.addEventListener("click", async () => {
  let folder = null;
  if (isElectron() && window.electronAPI.selectFolder) {
    folder = await window.electronAPI.selectFolder();
  } else {
    // Fallback for non-Electron: prompt the user
    folder = prompt("Enter folder path:");
  }
  if (!folder) return;

  // Confirm
  if (!confirm(`Scan folder "${folder}"?\n\nThis will purge existing downloaded data and search pornolab for each video file.`)) return;

  currentFolder = folder;
  folderPathInput.value = folder;
  // Save to server so it survives restart (config.json)
  await fetch("/api/downloaded/folder", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderPath: folder }),
  });
  btnRefresh.disabled = false;

  await scanFolder(folder, "scan-folder");
});

// Refresh button — only scan new files
btnRefresh.addEventListener("click", async () => {
  if (!currentFolder) return;
  await scanFolder(currentFolder, "scan-incremental");
});

async function scanFolder(folderPath, mode) {
  if (isScanning) return;
  isScanning = true;
  btnSelectFolder.disabled = true;
  btnRefresh.disabled = true;

  downloadedProgress.hidden = false;
  downloadedProgressLog.textContent = "";
  downloadedProgressBar.style.width = "0%";
  const isIncremental = mode === "scan-incremental";
  showStatus(downloadedStatus, isIncremental ? "Refreshing..." : "Scanning...", false);

  const endpoint = `/api/downloaded/${mode}`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderPath }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    function processLines(text) {
      for (const line of text.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));

          if (data.phase === "captchaNeeded" && data.captcha) {
            captchaActiveId = data.captcha.captchaId;
            downloadedProgressLog.textContent += `\n⚠️ ${data.message}\n`;
            downloadedProgressLog.scrollTop = downloadedProgressLog.scrollHeight;
            showCaptchaModal(data.captcha.imageBase64);
          } else if (data.phase === "processing" || data.phase === "itemDone") {
            if (data.phase === "itemDone") {
              downloadedProgressLog.textContent += `✅ ${data.message}\n`;
            } else {
              downloadedProgressLog.textContent += `🔍 ${data.message}\n`;
            }
            downloadedProgressLog.scrollTop = downloadedProgressLog.scrollHeight;
            if (data.total) {
              const pct = Math.round((data.current / data.total) * 100);
              downloadedProgressBar.style.width = pct + "%";
            }
          } else if (data.phase === "done") {
            downloadedProgressLog.textContent += `\n✅ ${data.message}\n`;
            downloadedProgressBar.style.width = "100%";
            showStatus(downloadedStatus, data.message, false);
            // Refresh the known-tag cache so the toolbar filter mirrors the
            // latest set of tags encountered during the scan.
            loadAllKnownTags();
            if (data.items) {
              downloadedItems = data.items;
              renderDownloadedItems();
            } else {
              // Re-fetch from the API so sort/filter controls stay in sync.
              loadDownloadedItems();
            }
            return true;
          } else if (data.phase === "error") {
            downloadedProgressLog.textContent += `\n❌ ${data.message}\n`;
            showStatus(downloadedStatus, `Error: ${data.message}`, true);
            return true;
          } else {
            downloadedProgressLog.textContent += `${data.message || data.phase}\n`;
            downloadedProgressLog.scrollTop = downloadedProgressLog.scrollHeight;
          }
        } catch {}
      }
      return false;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) processLines(buffer);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      if (processLines(lines.join("\n"))) break;
    }

    // If the stream ended without a "done" event, try loading items as a fallback
    if (!downloadedItems.length) {
      await loadDownloadedItems();
    }
  } catch (err) {
    showStatus(downloadedStatus, `Error: ${err.message}`, true);
  } finally {
    isScanning = false;
    btnSelectFolder.disabled = false;
    btnRefresh.disabled = false;
  }
}

async function loadDownloadedItems() {
  try {
    const params = new URLSearchParams();
    const q = downloadedSearchInput ? downloadedSearchInput.value.trim() : "";
    if (q) params.set("q", q);
    if (downloadedSortBy) params.set("sortBy", downloadedSortBy.value);
    if (downloadedSortDir) params.set("sortDir", downloadedSortDir.value);
    const activeTagFilters = downloadedTagFilter.getActiveFilters();
    if (activeTagFilters.length) params.set("tags", activeTagFilters.join(","));
    const qs = params.toString();
    const url = qs ? `/api/downloaded?${qs}` : "/api/downloaded";
    const res = await fetch(url);
    if (!res.ok) return;
    downloadedItems = await res.json();
    renderDownloadedItems();
  } catch (err) {
    console.error("Failed to load downloaded items:", err);
  }
}

async function loadAllKnownTags() {
  try {
    const res = await fetch("/api/downloaded/tags");
    if (!res.ok) return;
    const data = await res.json();
    // Server returns [{name, color}, ...]; older code expected bare strings,
    // so coerce defensively for safety.
    const tags = Array.isArray(data.tags) ? data.tags : [];
    allKnownTags = tags.map((t) => (typeof t === "string" ? { name: t, color: null } : { name: String(t.name || ""), color: t.color || null }));
    downloadedTagFilter.setKnownTags(allKnownTags);
  } catch (err) {
    console.error("Failed to load known tags:", err);
  }
}

function renderDownloadedItems() {
  // Apply client-side actress filter (server handles search + sort).
  const actressMode = downloadedFilterActress ? downloadedFilterActress.value : "";
  let visible = downloadedItems;
  if (actressMode) {
    visible = visible.filter((item) => matchesActressFilter(item, actressMode));
  }

  const activeTagFilters = downloadedTagFilter.getActiveFilters();
  const tagFiltered = activeTagFilters.length > 0;
  const totalLabel = downloadedItems.length === visible.length
    ? `${visible.length} file(s)`
    : `${visible.length} of ${downloadedItems.length} file(s)`;
  downloadedCount.textContent = visible.length ? totalLabel : "";
  if (actressMode === "fav" && visible.length) {
    downloadedCount.textContent += " — ★ fav actresses";
  } else if (actressMode.startsWith("actress:") && visible.length) {
    const actress = actressItems.find((a) => a.id === parseInt(actressMode.slice("actress:".length), 10));
    if (actress) downloadedCount.textContent += ` — 🎭 ${actress.name}`;
  }
  if (tagFiltered && visible.length) {
    downloadedCount.textContent += ` — 🏷️ ${activeTagFilters.join(", ")}`;
  }

  if (downloadedItems.length === 0) {
    downloadedContainer.innerHTML = '<div class="empty-state">No downloaded files found.</div>';
    return;
  }
  if (visible.length === 0) {
    downloadedContainer.innerHTML = '<div class="empty-state">No items match the current filter.</div>';
    return;
  }

  downloadedContainer.innerHTML = visible
    .map((item) => {
      const imgSrc = item.cachedImage ? `/api/downloaded/images/${encodeURIComponent(item.cachedImage)}` : null;
      const isFav = matchesFavActress(item);
      const favClass = isFav ? " result-card--fav" : "";
      const tagsData = encodeTagsDataAttr(item.tags || []);
      // Carry data attributes so the Edit modal can populate itself.
      const dataset = [
        `data-id="${item.id}"`,
        `data-file-path="${esc(item.filePath)}"`,
        `data-url="${esc(item.topicUrl || "")}"`,
        `data-title="${esc(item.title || "")}"`,
        `data-starring="${esc(item.starring || "")}"`,
        `data-production-date="${esc(item.productionDate || "")}"`,
        `data-duration="${esc(item.duration || "")}"`,
        `data-size="${esc(item.size || "")}"`,
        `data-post-image="${esc(item.postImage || "")}"`,
        `data-cached-image="${esc(item.cachedImage || "")}"`,
        `data-tags="${tagsData}"`,
      ].join(" ");

      const tagsHtml = renderTagChips(item.tags || []);

      return `
      <div class="result-card${favClass}" ${dataset}>
        ${imgSrc
          ? `<div class="result-thumb-container"><img class="result-thumb" src="${imgSrc}" alt="" loading="lazy" onerror="this.style.display='none'" /></div>`
          : `<div class="result-thumb-container"><div class="result-thumb-placeholder">🎬</div></div>`}
        <div class="result-info">
          <div class="result-title">${item.title ? `<a href="${esc(item.topicUrl)}" target="_blank">${esc(item.title)}</a>` : `<span class="no-match">${esc(item.fileName)}</span>`}</div>
          <div class="result-meta">
            ${item.title ? `<div class="result-meta-row result-meta-row--header"><span><span class="label">File:</span> <span class="value">${esc(item.fileName)}</span></span></div>` : ""}
            <div class="result-meta-row result-meta-row--details">
              ${item.starring ? `<span><span class="label">Cast:</span> <span class="value">${renderCastLinks(item.starring)}</span></span>` : ""}
              ${item.productionDate ? `<span><span class="label">Date:</span> <span class="value">${esc(item.productionDate)}</span></span>` : ""}
              ${item.duration ? `<span><span class="label">Duration:</span> <span class="value">${esc(item.duration)}</span></span>` : ""}
              ${item.size ? `<span><span class="label">Size:</span> <span class="value">${esc(item.size)}</span></span>` : ""}
            </div>
          </div>
          <div class="result-actions">
            <div class="result-actions-menu-wrapper">
              <button class="btn btn-small btn-menu-trigger" data-action="menu">⋯</button>
              <div class="popup-menu" data-popup-menu>
                <button class="popup-menu-item" data-action="set-url">🔗 Set topic URL</button>
                <button class="popup-menu-item" data-action="refresh-item">🔄 Refresh details</button>
                <button class="popup-menu-item" data-action="edit">✏️ Edit</button>
                <button class="popup-menu-item danger" data-action="delete">🗑 Delete</button>
              </div>
            </div>
            <button class="btn btn-small" data-action="play">▶ Play</button>
            <button class="btn btn-small" data-action="screens" ${item.topicUrl ? "" : 'style="display:none"'}>🖼 Screens</button>
            <button class="btn btn-small" data-action="show-in-finder">📂 Show in Finder</button>
          </div>
          <div class="item-tags" data-item-tags>
            ${tagsHtml}
            <button class="btn btn-small btn-tag-add" data-action="add-tag" title="Add or assign tag">+ Add tag</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

// Event delegation for downloaded items
downloadedContainer.addEventListener("click", async (e) => {
  // Popup menu trigger
  const menuBtn = e.target.closest("[data-action='menu']");
  if (menuBtn) {
    e.stopPropagation();
    document.querySelectorAll(".popup-menu.open").forEach((m) => m.classList.remove("open"));
    const menu = menuBtn.parentElement.querySelector(".popup-menu");
    if (menu) menu.classList.toggle("open");
    return;
  }

  // Set topic URL
  const setUrlBtn = e.target.closest("[data-action='set-url']");
  if (setUrlBtn) {
    setUrlBtn.closest(".popup-menu")?.classList.remove("open");
    const card = setUrlBtn.closest(".result-card");
    openSetUrlModal(card);
    return;
  }

  // Refresh item
  const refreshBtn = e.target.closest("[data-action='refresh-item']");
  if (refreshBtn) {
    refreshBtn.closest(".popup-menu")?.classList.remove("open");
    const card = refreshBtn.closest(".result-card");
    const id = parseInt(card.dataset.id, 10);

    try {
      showStatus(downloadedStatus, "Refreshing details...", false);
      const res = await fetch("/api/downloaded/refresh-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
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
          if (data.phase === "captchaNeeded" && data.captcha) {
            captchaActiveId = data.captcha.captchaId;
            showCaptchaModal(data.captcha.imageBase64);
          } else if (data.phase === "done") {
            showStatus(downloadedStatus, data.message, false);
            await loadDownloadedItems();
          } else if (data.phase === "error") {
            showStatus(downloadedStatus, `Error: ${data.message}`, true);
          }
        }
      }
    } catch (err) {
      showStatus(downloadedStatus, `Error: ${err.message}`, true);
    }
    return;
  }

  // Delete (db row + file)
  const deleteBtn = e.target.closest("[data-action='delete']");
  if (deleteBtn) {
    deleteBtn.closest(".popup-menu")?.classList.remove("open");
    const card = deleteBtn.closest(".result-card");
    const id = parseInt(card.dataset.id, 10);
    if (!confirm("Delete this downloaded file and its database entry?")) return;

    try {
      const res = await fetch(`/api/downloaded/item?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.deleted) {
        card.style.transition = "opacity 0.3s, transform 0.3s";
        card.style.opacity = "0";
        card.style.transform = "translateX(-20px)";
        setTimeout(() => {
          card.remove();
          downloadedItems = downloadedItems.filter((i) => i.id !== id);
          // Re-render so the count and any filtering stays in sync.
          renderDownloadedItems();
        }, 300);
      }
    } catch (err) {
      showStatus(downloadedStatus, `Error: ${err.message}`, true);
    }
    return;
  }

  // Play
  const playBtn = e.target.closest("[data-action='play']");
  if (playBtn) {
    const card = playBtn.closest(".result-card");
    const filePath = card.dataset.filePath;
    if (isElectron() && window.electronAPI.openPath) {
      await window.electronAPI.openPath(filePath);
    } else {
      // Fallback in non-Electron context
      window.open(`file://${filePath}`, "_blank");
    }
    return;
  }

  // Screens
  const screensBtn = e.target.closest("[data-action='screens']");
  if (screensBtn) {
    const card = screensBtn.closest(".result-card");
    const topicUrl = card.dataset.url;
    if (!topicUrl) return;
    await openImageCarousel(topicUrl, card.querySelector(".result-title")?.textContent || "Images");
    return;
  }

  // Show in Finder
  const finderBtn = e.target.closest("[data-action='show-in-finder']");
  if (finderBtn) {
    const card = finderBtn.closest(".result-card");
    const filePath = card.dataset.filePath;
    if (isElectron() && window.electronAPI.showItemInFolder) {
      await window.electronAPI.showItemInFolder(filePath);
    }
    return;
  }

  // Edit item
  const editBtn = e.target.closest("[data-action='edit']");
  if (editBtn) {
    editBtn.closest(".popup-menu")?.classList.remove("open");
    const card = editBtn.closest(".result-card");
    openEditModal(card);
    return;
  }

  // Add tag to an item — opens the shared Add Tag modal pre-populated for this card.
  const addTagBtn = e.target.closest("[data-action='add-tag']");
  if (addTagBtn) {
    const card = addTagBtn.closest(".result-card");
    const id = parseInt(card.dataset.id, 10);
    TagModal.open({
      key: id,
      tags: decodeTagsDataAttr(card.dataset.tags),
      knownTags: allKnownTags,
      persist: (nextTags) => persistTags(id, nextTags),
      onSaved: (updatedTags) => {
        updateItemTags(id, updatedTags);
        card.dataset.tags = JSON.stringify(updatedTags);
        const wrap = card.querySelector("[data-item-tags]");
        if (wrap) {
          wrap.innerHTML = `${renderTagChips(updatedTags)}<button class="btn btn-small btn-tag-add" data-action="add-tag" title="Add or assign tag">+ Add tag</button>`;
        }
        loadAllKnownTags();
        if (downloadedTagFilter.getActiveFilters().length) loadDownloadedItems();
      },
    });
    return;
  }

  // Remove a single tag chip ("X" button on the chip).
  const removeTagBtn = e.target.closest("[data-action='remove-tag']");
  if (removeTagBtn) {
    e.stopPropagation();
    const card = removeTagBtn.closest(".result-card");
    const tagName = removeTagBtn.dataset.tagName || "";
    if (!tagName) return;
    removeTagFromCard(card, tagName);
    return;
  }
});

// --- Downloaded: Edit modal ---

const editModal = document.getElementById("edit-modal");
const editIdInput = document.getElementById("edit-id");
const editTopicUrlInput = document.getElementById("edit-topic-url");
const editTitleInput = document.getElementById("edit-title");
const editCastInput = document.getElementById("edit-starring");
const editDateInput = document.getElementById("edit-production-date");
const editDurationInput = document.getElementById("edit-duration");
const editSizeInput = document.getElementById("edit-size");
const editPostImageUrlInput = document.getElementById("edit-post-image-url");
const editPostImageImg = document.getElementById("edit-post-image-img");
const editPostImagePlaceholder = document.getElementById("edit-post-image-placeholder");
const editPostImageStatus = document.getElementById("edit-post-image-status");
const editApplyPostImage = document.getElementById("edit-apply-post-image");
const editClearPostImage = document.getElementById("edit-clear-post-image");
const editSaveBtn = document.getElementById("edit-save");
const editCancelBtn = document.getElementById("edit-cancel");
const editCloseBtn = document.getElementById("edit-close");
const editProgressLog = document.getElementById("edit-progress-log");

let editItem = null;     // last-known state of the card being edited
let editCachedImageStash = null; // cachedImage filename to keep if user cancels

function buildEditPostImageSrc(cachedFileName) {
  if (!cachedFileName) return null;
  return `/api/downloaded/images/${encodeURIComponent(cachedFileName)}`;
}

function openEditModal(card) {
  if (!card) return;
  editItem = {
    id: parseInt(card.dataset.id, 10),
    title: card.dataset.title || "",
    starring: card.dataset.starring || "",
    productionDate: card.dataset["productionDate"] || "",
    duration: card.dataset.duration || "",
    size: card.dataset.size || "",
    cachedImage: card.dataset.cachedImage || "",
    topicUrl: card.dataset.url || "",
  };
  editCachedImageStash = editItem.cachedImage;

  editIdInput.value = String(editItem.id);
  editTopicUrlInput.value = editItem.topicUrl;
  editTitleInput.value = editItem.title;
  editCastInput.value = editItem.starring;
  editDateInput.value = editItem.productionDate;
  editDurationInput.value = editItem.duration;
  editSizeInput.value = editItem.size;
  editPostImageUrlInput.value = "";

  const src = buildEditPostImageSrc(editItem.cachedImage);
  if (src) {
    editPostImageImg.src = src;
    editPostImageImg.style.display = "block";
    editPostImagePlaceholder.style.display = "none";
  } else {
    editPostImageImg.style.display = "none";
    editPostImagePlaceholder.style.display = "block";
    editPostImageImg.removeAttribute("src");
  }
  editPostImageStatus.textContent = "";
  editProgressLog.style.display = "none";
  editProgressLog.textContent = "";
  editSaveBtn.disabled = false;
  editCancelBtn.disabled = false;
  editModal.hidden = false;
}

function closeEditModal() {
  editModal.hidden = true;
  editItem = null;
  editCachedImageStash = null;
}

editCloseBtn.addEventListener("click", closeEditModal);
editCancelBtn.addEventListener("click", closeEditModal);
editModal.addEventListener("click", (e) => {
  if (e.target === editModal) closeEditModal();
});

editApplyPostImage.addEventListener("click", async () => {
  if (!editItem) return;
  const url = editPostImageUrlInput.value.trim();
  if (!url) {
    editPostImageStatus.textContent = "Enter a URL first";
    editPostImageStatus.className = "status-msg error";
    return;
  }
  editPostImageStatus.textContent = "Resolving & downloading...";
  editPostImageStatus.className = "status-msg";
  editApplyPostImage.disabled = true;
  editClearPostImage.disabled = true;
  try {
    const res = await fetch("/api/downloaded/item", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editItem.id, postImageUrl: url }),
    });
    await streamEditSse(res, editApplyPostImage, editClearPostImage);
    await loadDownloadedItems();
    // After reload, find the card again and refresh the preview pane.
    const card = downloadedContainer.querySelector(`.result-card[data-id="${editItem.id}"]`);
    if (card) {
      editItem.cachedImage = card.dataset.cachedImage || "";
      const src = buildEditPostImageSrc(editItem.cachedImage);
      if (src) {
        editPostImageImg.src = src;
        editPostImageImg.style.display = "block";
        editPostImagePlaceholder.style.display = "none";
      } else {
        editPostImageImg.removeAttribute("src");
        editPostImageImg.style.display = "none";
        editPostImagePlaceholder.style.display = "block";
      }
    }
    editPostImageStatus.textContent = editItem.cachedImage ? "✅ Image updated" : "⚠️ Couldn't resolve — original kept";
    editPostImageStatus.className = "status-msg " + (editItem.cachedImage ? "success" : "error");
  } catch (err) {
    editPostImageStatus.textContent = `Error: ${err.message}`;
    editPostImageStatus.className = "status-msg error";
  } finally {
    editApplyPostImage.disabled = false;
    editClearPostImage.disabled = false;
  }
});

editClearPostImage.addEventListener("click", async () => {
  if (!editItem) return;
  editPostImageUrlInput.value = "";
  try {
    const res = await fetch("/api/downloaded/item", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editItem.id, postImageUrl: null }),
    });
    await streamEditSse(res, null, null);
    await loadDownloadedItems();
    editItem.cachedImage = "";
    editPostImageImg.removeAttribute("src");
    editPostImageImg.style.display = "none";
    editPostImagePlaceholder.style.display = "block";
    editPostImageStatus.textContent = "Image cleared";
    editPostImageStatus.className = "status-msg success";
  } catch (err) {
    editPostImageStatus.textContent = `Error: ${err.message}`;
    editPostImageStatus.className = "status-msg error";
  }
});

editSaveBtn.addEventListener("click", async () => {
  if (!editItem) return;
  const fields = {};
  // topicUrl is intentionally NOT editable here — use "Set topic URL" or
  // "Refresh details" from the popup menu to change it.
  const textInputs = [
    ["title", editTitleInput],
    ["starring", editCastInput],
    ["productionDate", editDateInput],
    ["duration", editDurationInput],
    ["size", editSizeInput],
  ];
  for (const [key, input] of textInputs) {
    const v = input.value.trim();
    fields[key] = v || null;
  }
  fields["id"] = editItem.id;

  editSaveBtn.disabled = true;
  editCancelBtn.disabled = true;
  editProgressLog.style.display = "block";
  editProgressLog.textContent = "";

  try {
    const res = await fetch("/api/downloaded/item", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    await streamEditSse(res, null, null);
    await loadDownloadedItems();
    showStatus(downloadedStatus, "Item updated", false);
    closeEditModal();
  } catch (err) {
    editProgressLog.textContent += `\n❌ ${err.message}\n`;
  } finally {
    editSaveBtn.disabled = false;
    editCancelBtn.disabled = false;
  }
});

// Shared SSE stream reader for the edit modal.
async function streamEditSse(res, applyBtn, clearBtn) {
  if (!res.body || !res.body.getReader) {
    return;
  }
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
      try {
        const data = JSON.parse(line.slice(6));
        if (data.phase === "captchaNeeded" && data.captcha) {
          captchaActiveId = data.captcha.captchaId;
          showCaptchaModal(data.captcha.imageBase64);
        } else if (data.phase === "processing") {
          if (editProgressLog) {
            editProgressLog.textContent += `🔍 ${data.message}\n`;
            editProgressLog.scrollTop = editProgressLog.scrollHeight;
          }
        } else if (data.phase === "error") {
          if (editProgressLog) editProgressLog.textContent += `\n❌ ${data.message}\n`;
          if (applyBtn) applyBtn.disabled = false;
          if (clearBtn) clearBtn.disabled = false;
        } else if (data.phase === "done") {
          if (editProgressLog) editProgressLog.textContent += `\n✅ ${data.message}\n`;
        }
      } catch {}
    }
  }
}

// --- Downloaded: Set Topic URL modal ---

const setUrlModal = document.getElementById("set-url-modal");
const setUrlIdInput = document.getElementById("set-url-id");
const setUrlInput = document.getElementById("set-url-input");
const setUrlStatus = document.getElementById("set-url-status");
const setUrlLog = document.getElementById("set-url-log");
const setUrlApply = document.getElementById("set-url-apply");
const setUrlCancelBtn = document.getElementById("set-url-cancel");
const setUrlCloseBtn = document.getElementById("set-url-close");
let setUrlInFlight = false;

function openSetUrlModal(card) {
  if (!card) return;
  setUrlIdInput.value = String(parseInt(card.dataset.id, 10));
  setUrlInput.value = card.dataset.url || "";
  setUrlStatus.textContent = "";
  setUrlStatus.className = "status-msg";
  setUrlLog.style.display = "none";
  setUrlLog.textContent = "";
  setUrlApply.disabled = false;
  setUrlCancelBtn.disabled = false;
  setUrlModal.hidden = false;
  setTimeout(() => setUrlInput.focus(), 0);
}

function closeSetUrlModal() {
  if (setUrlInFlight) return;
  setUrlModal.hidden = true;
}

setUrlCloseBtn.addEventListener("click", closeSetUrlModal);
setUrlCancelBtn.addEventListener("click", closeSetUrlModal);
setUrlModal.addEventListener("click", (e) => {
  if (e.target === setUrlModal) closeSetUrlModal();
});
setUrlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    setUrlApply.click();
  }
});

setUrlApply.addEventListener("click", async () => {
  const id = parseInt(setUrlIdInput.value, 10);
  const url = setUrlInput.value.trim();
  if (!id) {
    setUrlStatus.textContent = "Missing item id.";
    setUrlStatus.className = "status-msg error";
    return;
  }

  setUrlInFlight = true;
  setUrlApply.disabled = true;
  setUrlCancelBtn.disabled = true;
  setUrlLog.style.display = "block";
  setUrlLog.textContent = "";
  setUrlStatus.textContent = url ? "Fetching topic details..." : "Clearing topic URL...";
  setUrlStatus.className = "status-msg";

  try {
    const res = await fetch("/api/downloaded/topic-url", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, topicUrl: url }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let succeeded = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.phase === "captchaNeeded" && data.captcha) {
            captchaActiveId = data.captcha.captchaId;
            showCaptchaModal(data.captcha.imageBase64);
          } else if (data.phase === "processing") {
            setUrlLog.textContent += `🔍 ${data.message}\n`;
            setUrlLog.scrollTop = setUrlLog.scrollHeight;
          } else if (data.phase === "done") {
            succeeded = true;
            setUrlLog.textContent += `\n✅ ${data.message}\n`;
            setUrlStatus.textContent = url ? "Topic URL set — refreshing..." : "Topic URL cleared — refreshing...";
            setUrlStatus.className = "status-msg success";
            await loadDownloadedItems();
          } else if (data.phase === "error") {
            setUrlLog.textContent += `\n❌ ${data.message}\n`;
            setUrlStatus.textContent = `Error: ${data.message}`;
            setUrlStatus.className = "status-msg error";
          }
        } catch {}
      }
    }

    if (succeeded) {
      setTimeout(() => {
        setUrlModal.hidden = true;
        setUrlInFlight = false;
        showStatus(downloadedStatus, url ? "Topic URL set!" : "Topic URL cleared!", false);
      }, 600);
    } else {
      setUrlInFlight = false;
    }
  } catch (err) {
    setUrlLog.textContent += `\n❌ ${err.message}\n`;
    setUrlStatus.textContent = `Error: ${err.message}`;
    setUrlStatus.className = "status-msg error";
    setUrlInFlight = false;
  } finally {
    setUrlApply.disabled = false;
    setUrlCancelBtn.disabled = false;
  }
});

if (downloadedSortDir) {
  downloadedSortDir.addEventListener("change", () => {
    if (currentFolder) loadDownloadedItems();
  });
}

// Eagerly load the known-tag list so the toolbar filter appears as soon
// as the user opens the Downloaded tab (if a folder is already selected).
if (currentFolder) loadAllKnownTags();

// --- Downloaded: tag management ---

async function persistTags(id, tags) {
  try {
    const res = await fetch("/api/downloaded/tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, tags }),
    });
    if (!res.ok) {
      showStatus(downloadedStatus, `Error: failed to update tags (${res.status})`, true);
      return null;
    }
    const data = await res.json();
    return Array.isArray(data.tags) ? data.tags : [];
  } catch (err) {
    showStatus(downloadedStatus, `Error: ${err.message}`, true);
    return null;
  }
}

// Update the in-memory cache for an item so the next render reflects the change.
function updateItemTags(id, tags) {
  const item = downloadedItems.find((i) => i.id === id);
  if (item) item.tags = tags;
}

// Remove a single tag from a card in-place without a full re-fetch, and
// roll back on failure.
async function removeTagFromCard(card, tagName) {
  if (!card) return;
  const id = parseInt(card.dataset.id, 10);
  const current = decodeTagsDataAttr(card.dataset.tags);
  const next = current.filter((t) => tagNameLower(t) !== tagName.toLowerCase());
  if (next.length === current.length) return;
  const chip = card.querySelector(`.tag-chip[data-tag-name="${cssEscape(tagName)}"]`);
  if (chip) chip.style.opacity = "0.4";
  const updated = await persistTags(id, next);
  if (updated === null) {
    if (chip) chip.style.opacity = "1";
    return;
  }
  updateItemTags(id, updated);
  card.dataset.tags = JSON.stringify(updated);
  if (chip) chip.remove();
  loadAllKnownTags();
  // Refresh if the removed tag was part of an active filter — the item may
  // no longer satisfy the filter and should disappear from the view.
  if (downloadedTagFilter.getActiveFilters().length) loadDownloadedItems();
}

// --- Downloaded: filter / sort controls ---
if (downloadedSearchInput) {
  let searchDebounce = null;
  downloadedSearchInput.addEventListener("input", () => {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      if (currentFolder) loadDownloadedItems();
    }, 200);
  });
  downloadedSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (currentFolder) loadDownloadedItems();
    }
  });
}
if (downloadedFilterActress) {
  downloadedFilterActress.addEventListener("change", () => {
    // Actress filter is purely client-side — just re-render.
    if (downloadedItems.length) renderDownloadedItems();
  });
}
if (downloadedSortBy) {
  downloadedSortBy.addEventListener("change", () => {
    if (currentFolder) loadDownloadedItems();
  });
}
if (downloadedSortDir) {
  downloadedSortDir.addEventListener("change", () => {
    if (currentFolder) loadDownloadedItems();
  });
}
