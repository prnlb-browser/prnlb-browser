const searchQuery = document.getElementById("search-query");
const btnSearch = document.getElementById("btn-search");
const searchForumFilter = document.getElementById("filter-search-forum");
const searchStatus = document.getElementById("search-status");
const searchProgress = document.getElementById("search-progress");
const searchProgressBar = document.getElementById("search-progress-bar");
const searchProgressLog = document.getElementById("search-progress-log");
const searchResultsContainer = document.getElementById("search-results-container");
// --- Search ---

let searchForumOptions = [];
let isSearching = false;
let lastSearchResults = []; // Store for referencing by index
let searchDetailGeneration = 0; // Cancel stale detail loading

async function loadSearchForumOptions() {
  try {
    const res = await fetch("/api/search/forums");
    if (!res.ok) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let forums = null;

    function processLines(text) {
      for (const line of text.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.phase === "captchaNeeded" && data.captcha) {
            captchaActiveId = data.captcha.captchaId;
            showCaptchaModal(data.captcha.imageBase64);
          } else if (data.phase === "results") {
            forums = data.data;
            return true;
          } else if (data.phase === "error") {
            console.error("Forum options error:", data.message);
            return true;
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

    if (!forums || !Array.isArray(forums)) return;
    searchForumOptions = forums;
    // Populate the multi-select
    searchForumFilter.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "-1";
    allOpt.textContent = "Everywhere";
    allOpt.selected = true;
    searchForumFilter.appendChild(allOpt);
    forums.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = String(f.id);
      opt.textContent = f.name;
      searchForumFilter.appendChild(opt);
    });
  } catch (err) {
    console.error("Failed to load search forum options:", err);
  }
}

function getSelectedSearchForums() {
  const selected = Array.from(searchForumFilter.selectedOptions).map((o) =>
    parseInt(o.value, 10),
  );
  if (selected.length === 0 || selected.includes(-1)) return undefined;
  return selected;
}

async function performSearch(start = 0) {
  const query = searchQuery.value.trim();
  if (!query) {
    showStatus(searchStatus, "Enter a search phrase", true);
    return;
  }
  if (isSearching) return;

  isSearching = true;
  btnSearch.disabled = true;
  btnSearch.textContent = "⏳ Searching...";
  searchResultsContainer.innerHTML = "";
  const paginationEl = document.getElementById("search-pagination");
  if (paginationEl) paginationEl.innerHTML = "";
  searchProgress.hidden = false;
  searchProgressLog.textContent = "";
  searchProgressBar.style.width = "0%";
  showStatus(searchStatus, start > 0 ? `Loading page ${Math.floor(start / 50) + 1}...` : "Starting search...", false);

  const forums = getSelectedSearchForums();

  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, forums, start }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    function processLines(text) {
      for (const line of text.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));

          if (data.phase === "login" || data.phase === "listing") {
            searchProgressLog.textContent += `${data.message}\n`;
            searchProgressLog.scrollTop = searchProgressLog.scrollHeight;
          } else if (data.phase === "captchaNeeded" && data.captcha) {
            captchaActiveId = data.captcha.captchaId;
            searchProgressLog.textContent += `\n⚠️ ${data.message}\n`;
            searchProgressLog.scrollTop = searchProgressLog.scrollHeight;
            showCaptchaModal(data.captcha.imageBase64);
          } else if (data.phase === "detail") {
            searchProgressLog.textContent += `${data.message}\n`;
            searchProgressLog.scrollTop = searchProgressLog.scrollHeight;
          } else if (data.phase === "done") {
            searchProgressLog.textContent += `\n✅ ${data.message}\n`;
            searchProgressBar.style.width = "100%";
          } else if (data.phase === "results") {
            renderSearchResults(data.data);
            if (data.pagination) {
              renderSearchPagination(data.pagination);
            }
            return true;
          } else if (data.phase === "error") {
            searchProgressLog.textContent += `\n❌ ${data.message}\n`;
            showStatus(searchStatus, `Error: ${data.message}`, true);
            return true;
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
  } catch (err) {
    showStatus(searchStatus, `Error: ${err.message}`, true);
  } finally {
    isSearching = false;
    btnSearch.disabled = false;
    btnSearch.textContent = "🔍 Search";
  }
}

function renderSearchResults(topics) {
  if (!topics || topics.length === 0) {
    searchResultsContainer.innerHTML =
      '<div class="empty-state">No results found.</div>';
    showStatus(searchStatus, "No results", false);
    return;
  }

  lastSearchResults = topics;

  showStatus(searchStatus, `${topics.length} results found`, false);

  searchResultsContainer.innerHTML = topics
    .map((t, idx) => {
      const isFav = matchesFavActress(t);
      const extraClass = isFav ? " result-card--fav" : "";
      return `
      <div class="result-card${extraClass}" data-url="${esc(t.topicUrl)}" data-title="${esc(t.title)}" data-idx="${idx}">
        <div class="result-thumb-container">
          ${t.postImage
            ? `<img class="result-thumb" src="${esc(t.postImage)}" alt="" loading="lazy" onerror="this.style.display='none'" />`
            : `<div class="result-thumb-placeholder">📷</div>`}
        </div>
        <div class="result-info">
          <div class="result-title"><a href="${esc(t.topicUrl)}" target="_blank">${isFav ? "★ " : ""}${esc(t.title)}</a></div>
          <div class="result-meta">
            ${t.sourceForum ? `<div class="result-meta-row result-meta-row--header"><span><span class="label">Forum:</span> <span class="value">${esc(t.sourceForum)}</span></span></div>` : ""}
            <div class="result-meta-row result-meta-row--details">
              ${t.starring ? `<span class="detail-starring"><span class="label">Cast:</span> <span class="value">${esc(t.starring)}</span></span>` : ""}
              ${t.productionDate ? `<span class="detail-date"><span class="label">Date:</span> <span class="value">${esc(t.productionDate)}</span></span>` : ""}
              ${t.duration ? `<span class="detail-duration"><span class="label">Duration:</span> <span class="value">${esc(t.duration)}</span></span>` : ""}
              ${t.size ? `<span><span class="label">Size:</span> <span class="value">${esc(t.size)}</span></span>` : ""}
            </div>
          </div>
          <div class="result-actions">
            ${t.torrentUrl ? `<a class="btn btn-small" href="${esc(t.torrentUrl)}" target="_blank">⬇ Torrent</a>` : ""}
            <button class="btn btn-small" data-action="screens" ${t.postImage ? "" : 'style="display:none"'}>🖼 Screens</button>
            <button class="btn btn-small btn-add" data-action="add">➕ Add</button>
          </div>
        </div>
      </div>`;
    })
    .join("");

  // Load topic details (post image + metadata) in background
  loadSearchDetails();
}

function renderSearchPagination(pagination) {
  const container = document.getElementById("search-pagination");
  if (!container || !pagination || pagination.totalPages <= 1) {
    if (container) container.innerHTML = "";
    return;
  }

  let html = '<div class="pagination">';

  // Previous button
  if (pagination.currentPage > 1) {
    html += `<button class="btn btn-small page-btn" data-start="${(pagination.currentPage - 2) * pagination.perPage}">← Prev</button>`;
  }

  // Page numbers
  const maxVisible = 7;
  let startPage = 1;
  let endPage = pagination.totalPages;
  if (pagination.totalPages > maxVisible) {
    startPage = Math.max(1, pagination.currentPage - 3);
    endPage = Math.min(pagination.totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }
  }

  if (startPage > 1) {
    html += `<button class="btn btn-small page-btn" data-start="0">1</button>`;
    if (startPage > 2) html += `<span class="pagination-ellipsis">…</span>`;
  }

  for (let i = startPage; i <= endPage; i++) {
    if (i === pagination.currentPage) {
      html += `<button class="btn btn-small btn-primary page-btn" disabled>${i}</button>`;
    } else {
      html += `<button class="btn btn-small page-btn" data-start="${(i - 1) * pagination.perPage}">${i}</button>`;
    }
  }

  if (endPage < pagination.totalPages) {
    if (endPage < pagination.totalPages - 1) html += `<span class="pagination-ellipsis">…</span>`;
    html += `<button class="btn btn-small page-btn" data-start="${(pagination.totalPages - 1) * pagination.perPage}">${pagination.totalPages}</button>`;
  }

  // Next button
  if (pagination.currentPage < pagination.totalPages) {
    html += `<button class="btn btn-small page-btn" data-start="${pagination.currentPage * pagination.perPage}">Next →</button>`;
  }

  html += "</div>";
  container.innerHTML = html;
}

// Pagination click handler
document.getElementById("search-pagination")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".page-btn");
  if (!btn || btn.disabled) return;
  const start = parseInt(btn.dataset.start, 10);
  if (isNaN(start)) return;
  performSearch(start);
});

// Background loading of topic details (post image + metadata)
async function loadSearchDetails() {
  const generation = ++searchDetailGeneration;
  const cards = Array.from(searchResultsContainer.querySelectorAll(".result-card"));
  const concurrency = 3;
  const queue = [...cards];

  async function processCard(card) {
    if (generation !== searchDetailGeneration) return; // stale
    const topicUrl = card.dataset.url;
    if (!topicUrl) return;

    // Skip cards that already have a real image
    const existingImg = card.querySelector(".result-thumb");
    if (existingImg) return;

    try {
      const res = await fetch(`/api/topic/details?url=${encodeURIComponent(topicUrl)}`);
      if (!res.ok) return;
      if (generation !== searchDetailGeneration) return;

      // Parse SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let details = null;

      function processLines(text) {
        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.phase === "captchaNeeded" && data.captcha) {
              captchaActiveId = data.captcha.captchaId;
              showCaptchaModal(data.captcha.imageBase64);
            } else if (data.phase === "results") {
              details = data.data;
              return true;
            } else if (data.phase === "error") {
              return true;
            }
          } catch {}
        }
        return false;
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buf.trim()) processLines(buf);
          break;
        }
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        if (processLines(lines.join("\n"))) break;
      }

      if (!details) return;
      if (generation !== searchDetailGeneration) return;

      // Update thumbnail
      const thumbContainer = card.querySelector(".result-thumb-container");
      if (thumbContainer && details.postImage) {
        thumbContainer.innerHTML = `<img class="result-thumb" src="${esc(details.postImage)}" alt="" loading="lazy" onerror="this.style.display='none'" />`;
      }

      // Update metadata
      const meta = card.querySelector(".result-meta");
      if (meta) {
        if (details.starring && !meta.querySelector(".detail-starring")) {
          const span = document.createElement("span");
          span.className = "detail-starring";
          span.innerHTML = `<span class="label">Cast:</span> <span class="value">${esc(details.starring)}</span>`;
          appendMetaField(meta, span, "Cast:");
        }
        if (details.productionDate && !meta.querySelector(".detail-date")) {
          const span = document.createElement("span");
          span.className = "detail-date";
          span.innerHTML = `<span class="label">Date:</span> <span class="value">${esc(details.productionDate)}</span>`;
          appendMetaField(meta, span, "Date:");
        }
        if (details.duration && !meta.querySelector(".detail-duration")) {
          const span = document.createElement("span");
          span.className = "detail-duration";
          span.innerHTML = `<span class="label">Duration:</span> <span class="value">${esc(details.duration)}</span>`;
          appendMetaField(meta, span, "Duration:");
        }
      }

      // Show Screens button now that we have an image
      if (details.postImage) {
        const screensBtn = card.querySelector('[data-action="screens"]');
        if (screensBtn) screensBtn.style.display = "";
      }

      // Update the stored topic data
      const idx = parseInt(card.dataset.idx, 10);
      if (!isNaN(idx) && lastSearchResults[idx]) {
        if (details.postImage) lastSearchResults[idx].postImage = details.postImage;
        if (details.starring) lastSearchResults[idx].starring = details.starring;
        if (details.productionDate) lastSearchResults[idx].productionDate = details.productionDate;
        if (details.duration) lastSearchResults[idx].duration = details.duration;
      }
    } catch {}
  }

  // Process cards with concurrency limit
  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const card = queue.shift();
          if (card) await processCard(card);
        }
      })(),
    );
  }
  await Promise.all(workers);
}

// Add button handler — add search result to DB
searchResultsContainer.addEventListener("click", async (e) => {
  // Handle "Add" button
  const addBtn = e.target.closest("[data-action='add']");
  if (addBtn) {
    const card = addBtn.closest(".result-card");
    if (!card) return;
    const idx = parseInt(card.dataset.idx, 10);
    const topic = lastSearchResults[idx];
    if (!topic) return;
    try {
      const res = await fetch("/api/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(topic),
      });
      const data = await res.json();
      if (data.inserted) {
        addBtn.textContent = "✅ Added";
        addBtn.disabled = true;
        addBtn.classList.remove("btn-add");
        addBtn.classList.add("btn-success");
      } else {
        addBtn.textContent = "⚠️ Exists";
        addBtn.disabled = true;
      }
    } catch (err) {
      showStatus(searchStatus, `Error adding: ${err.message}`, true);
    }
    return;
  }

  // Handle "Screens" button
  const screensBtn = e.target.closest("[data-action='screens']");
  if (screensBtn) {
    const card = screensBtn.closest(".result-card");
    if (!card) return;
    const topicUrl = card.dataset.url;
    const title = card.dataset.title || "Images";
    if (!topicUrl) return;
    await openImageCarousel(topicUrl, title);
    return;
  }
});

btnSearch.addEventListener("click", () => performSearch());
searchQuery.addEventListener("keydown", (e) => {
  if (e.key === "Enter") performSearch();
});

// Load search forum options on tab switch
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.dataset.tab === "search" && searchForumOptions.length === 0) {
      loadSearchForumOptions();
    }
  });
});

