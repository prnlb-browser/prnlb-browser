// --- State ---
let config = null;
let isRunning = false;

// --- Hidden topics (persisted in DB via API) ---
let hiddenSet = new Set();

async function loadHiddenSet(results) {
  // Build hidden set from the results themselves (hidden field comes from DB)
  hiddenSet = new Set(results.filter((t) => t.hidden).map((t) => t.topicUrl));
}

async function toggleHidden(topicUrl) {
  try {
    const res = await fetch("/api/results/hide", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicUrl }),
    });
    if (!res.ok) throw new Error("Failed to toggle hidden");
    const data = await res.json();
    if (data.hidden) {
      hiddenSet.add(topicUrl);
    } else {
      hiddenSet.delete(topicUrl);
    }
    return !!data.hidden;
  } catch (err) {
    console.error("toggleHidden error:", err);
    return hiddenSet.has(topicUrl);
  }
}

// --- DOM refs ---
const tabs = document.querySelectorAll(".tab");
const tabContents = document.querySelectorAll(".tab-content");
const forumsList = document.getElementById("forums-list");
const btnAddForum = document.getElementById("btn-add-forum");
const btnSaveConfig = document.getElementById("btn-save-config");
const btnClearDb = document.getElementById("btn-clear-db");
const configStatus = document.getElementById("config-status");
const btnStart = document.getElementById("btn-start");
const progressLog = document.getElementById("progress-log");
const progressBarContainer = document.getElementById("progress-bar-container");
const progressBar = document.getElementById("progress-bar");
const btnRefreshResults = document.getElementById("btn-refresh-results");
const resultCount = document.getElementById("result-count");
const searchInput = document.getElementById("search-input");
const filterForum = document.getElementById("filter-forum");
const filterActress = document.getElementById("filter-actress");
const filterHidden = document.getElementById("filter-hidden");
const resultsContainer = document.getElementById("results-container");
const favActressesList = document.getElementById("fav-actresses-list");
const favActressInput = document.getElementById("fav-actress-input");
const btnAddActress = document.getElementById("btn-add-actress");

// Search DOM refs
const searchQuery = document.getElementById("search-query");
const btnSearch = document.getElementById("btn-search");
const searchForumFilter = document.getElementById("search-forum-filter");
const searchStatus = document.getElementById("search-status");
const searchProgress = document.getElementById("search-progress");
const searchProgressBar = document.getElementById("search-progress-bar");
const searchProgressLog = document.getElementById("search-progress-log");
const searchResultsContainer = document.getElementById("search-results-container");

// Captcha DOM refs
const captchaModal = document.getElementById("captcha-modal");
const captchaModalClose = document.getElementById("captcha-modal-close");
const captchaImage = document.getElementById("captcha-image");
const captchaCodeInput = document.getElementById("captcha-code-input");
const captchaSubmit = document.getElementById("captcha-submit");
const captchaStatus = document.getElementById("captcha-status");

// --- Captcha Modal ---

function showCaptchaModal(imageBase64) {
  captchaImage.src = imageBase64;
  captchaCodeInput.value = "";
  captchaStatus.textContent = "";
  captchaModal.hidden = false;
  setTimeout(() => captchaCodeInput.focus(), 100);
}

function closeCaptchaModal() {
  captchaModal.hidden = true;
  captchaImage.src = "";
  captchaCodeInput.value = "";
  captchaStatus.textContent = "";
}

captchaModalClose.addEventListener("click", closeCaptchaModal);
captchaModal.addEventListener("click", (e) => {
  if (e.target === captchaModal) closeCaptchaModal();
});

async function submitCaptchaCode() {
  const code = captchaCodeInput.value.trim();
  if (!code) {
    captchaStatus.textContent = "Please enter the captcha code";
    captchaStatus.style.color = "#ff6b6b";
    return;
  }

  captchaStatus.textContent = "Submitting...";
  captchaStatus.style.color = "#aaa";
  captchaSubmit.disabled = true;

  try {
    const res = await fetch("/api/captcha", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ captchaId: captchaActiveId, code }),
    });
    const data = await res.json();
    if (data.success) {
      captchaStatus.textContent = "Code submitted! Waiting for login...";
      captchaStatus.style.color = "#51cf66";
      setTimeout(() => closeCaptchaModal(), 1500);
    } else {
      captchaStatus.textContent = "Failed to submit code — challenge expired";
      captchaStatus.style.color = "#ff6b6b";
    }
  } catch (err) {
    captchaStatus.textContent = `Error: ${err.message}`;
    captchaStatus.style.color = "#ff6b6b";
  } finally {
    captchaSubmit.disabled = false;
  }
}

captchaSubmit.addEventListener("click", submitCaptchaCode);
captchaCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitCaptchaCode();
});

let captchaActiveId = null;

// --- Tabs ---
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tabContents.forEach((tc) => tc.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
    if (tab.dataset.tab === "results") { loadForums(); loadResults(); }
  });
});

// --- Config ---

function renderForums() {
  forumsList.innerHTML = "";
  if (!config) return;
  config.forums.forEach((f, i) => {
    const div = document.createElement("div");
    div.className = "forum-entry";
    div.innerHTML = `
      <input type="text" value="${esc(f.label)}" data-field="label" placeholder="Label" style="flex: 0.6" />
      <input type="url" value="${esc(f.url)}" data-field="url" placeholder="Forum URL" />
      <button class="btn btn-small" data-remove="${i}">✕</button>
    `;
    div.querySelector(`[data-field="label"]`).addEventListener("input", (e) => {
      config.forums[i].label = e.target.value;
    });
    div.querySelector(`[data-field="url"]`).addEventListener("input", (e) => {
      config.forums[i].url = e.target.value;
    });
    div.querySelector(`[data-remove]`).addEventListener("click", () => {
      config.forums.splice(i, 1);
      renderForums();
    });
    forumsList.appendChild(div);
  });
}

function renderFavActresses() {
  if (!config) return;
  if (!config.favActresses) config.favActresses = [];
  favActressesList.innerHTML = "";
  config.favActresses.forEach((name, i) => {
    const div = document.createElement("div");
    div.className = "fav-actress-entry";
    div.innerHTML = `<span>★ ${esc(name)}</span><button class="btn btn-small btn-danger" data-remove-actress="${i}">✕</button>`;
    div.querySelector("[data-remove-actress]").addEventListener("click", () => {
      config.favActresses.splice(i, 1);
      renderFavActresses();
      saveFavActresses();
    });
    favActressesList.appendChild(div);
  });
}

function fillForm() {
  if (!config) return;
  document.getElementById("cfg-username").value = config.credentials.username;
  document.getElementById("cfg-password").value = config.credentials.password;
  document.getElementById("cfg-pages").value = config.pagesToScan;
  document.getElementById("cfg-headless").checked = config.headless;
  document.getElementById("cfg-output").value = config.outputFile;
  document.getElementById("cfg-delay-min").value = config.delay?.min ?? 2000;
  document.getElementById("cfg-delay-max").value = config.delay?.max ?? 5000;
  renderForums();
  renderFavActresses();
}

function collectForm() {
  config.credentials.username = document.getElementById("cfg-username").value;
  config.credentials.password = document.getElementById("cfg-password").value;
  config.pagesToScan = parseInt(document.getElementById("cfg-pages").value, 10) || 2;
  config.headless = document.getElementById("cfg-headless").checked;
  config.outputFile = document.getElementById("cfg-output").value || "output.json";
  config.delay = {
    min: parseInt(document.getElementById("cfg-delay-min").value, 10) || 2000,
    max: parseInt(document.getElementById("cfg-delay-max").value, 10) || 5000,
  };
}

async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error("Failed to load config");
    config = await res.json();
    fillForm();
  } catch (err) {
    showStatus(configStatus, err.message, true);
  }
}

btnAddForum.addEventListener("click", () => {
  if (!config) return;
  config.forums.push({ url: "", label: "" });
  renderForums();
});

btnAddActress.addEventListener("click", () => {
  if (!config) return;
  const name = favActressInput.value.trim();
  if (!name) return;
  if (!config.favActresses) config.favActresses = [];
  if (config.favActresses.some((a) => a.toLowerCase() === name.toLowerCase())) return;
  config.favActresses.push(name);
  favActressInput.value = "";
  renderFavActresses();
  saveFavActresses();
});

favActressInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnAddActress.click();
});

// --- Headless toggle sync ---
document.getElementById("cfg-headless").addEventListener("change", () => {
  collectForm();
});

async function saveFavActresses() {
  try {
    await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    showStatus(configStatus, "Favorites saved!", false);
  } catch (err) {
    showStatus(configStatus, "Failed to save favorites", true);
  }
}

btnSaveConfig.addEventListener("click", async () => {
  collectForm();
  try {
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error("Save failed");
    showStatus(configStatus, "Config saved!", false);
  } catch (err) {
    showStatus(configStatus, err.message, true);
  }
});

btnClearDb.addEventListener("click", async () => {
  if (!confirm("Are you sure you want to delete ALL topics from the database? This cannot be undone.")) return;
  try {
    const res = await fetch("/api/results", { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to clear database");
    const data = await res.json();
    showStatus(configStatus, data.message, false);
  } catch (err) {
    showStatus(configStatus, err.message, true);
  }
});

// --- Export CSV ---

document.getElementById("btn-export-csv").addEventListener("click", async () => {
  try {
    const res = await fetch("/api/results/export");
    if (!res.ok) throw new Error("Failed to export");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `topics-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showStatus(configStatus, "CSV exported!", false);
  } catch (err) {
    showStatus(configStatus, err.message, true);
  }
});

// --- Crawl ---

function appendLog(text) {
  if (progressLog.textContent === "Waiting...") progressLog.textContent = "";
  progressLog.textContent += text + "\n";
  progressLog.scrollTop = progressLog.scrollHeight;
}

function connectSSE() {
  const es = new EventSource("/api/events");
  es.onmessage = (e) => {
    const p = JSON.parse(e.data);
    if (p.phase === "idle") return;

    if (p.phase === "detail" && p.total) {
      const pct = Math.round((p.current / p.total) * 100);
      progressBarContainer.hidden = false;
      progressBar.style.width = pct + "%";
      const name = p.message.length > 70 ? p.message.substring(0, 70) + "..." : p.message;
      appendLog(`🔍 [${p.current}/${p.total}] ${name}`);
    } else if (p.phase === "captcha-needed" && p.captcha) {
      captchaActiveId = p.captcha.captchaId;
      appendLog(`\n⚠️ ${p.message}`);
      showCaptchaModal(p.captcha.imageBase64);
    } else if (p.phase === "done") {
      appendLog(`\n✅ ${p.message}`);
      progressBar.style.width = "100%";
      setRunning(false);
    } else if (p.phase === "error") {
      appendLog(`\n❌ ${p.message}`);
      setRunning(false);
    } else {
      appendLog(`${p.phase === "login" ? "🔐" : "📄"} ${p.message}`);
    }
  };
  es.onerror = () => {
    setTimeout(connectSSE, 3000);
  };
}

function setRunning(running) {
  isRunning = running;
  btnStart.disabled = running;
  btnStart.textContent = running ? "⏳ Running..." : "▶ Start Crawl";
}

btnStart.addEventListener("click", async () => {
  collectForm();
  // Save config first
  await fetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });

  progressLog.textContent = "";
  progressBarContainer.hidden = true;
  progressBar.style.width = "0%";
  setRunning(true);

  try {
    const res = await fetch("/api/crawl", { method: "POST" });
    const data = await res.json();
    if (data.error) {
      appendLog(`❌ ${data.error}`);
      setRunning(false);
    }
  } catch (err) {
    appendLog(`❌ ${err.message}`);
    setRunning(false);
  }
});

// --- Results ---

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

function matchesFavActress(topic, favActresses) {
  if (!favActresses || favActresses.length === 0) return false;
  const hay = ((topic.title || "") + " " + (topic.starring || "")).toLowerCase();
  return favActresses.some((a) => hay.includes(a.toLowerCase()));
}

async function loadResults() {
  try {
    const q = searchInput.value.trim();
    const forum = filterForum.value;
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (forum) params.set("forum", forum);
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
    const actressMode = filterActress.value; // "" or "fav"
    const favActresses = (config && config.favActresses) ? config.favActresses : [];

    let filtered = data;
    if (filterMode === "exclude") {
      filtered = filtered.filter((t) => !hiddenSet.has(t.topicUrl));
    }
    if (actressMode === "fav") {
      filtered = filtered.filter((t) => matchesFavActress(t, favActresses));
    }

    resultCount.textContent = `${filtered.length} topics` + (q ? ` (search: "${q}")` : " in DB");
    if (forum) resultCount.textContent += ` — ${forum}`;
    if (actressMode === "fav") resultCount.textContent += ` — ★ fav actresses`;
    if (filtered.length === 0) {
      resultsContainer.innerHTML = '<div class="empty-state">No topics found.</div>';
      return;
    }
    resultsContainer.innerHTML = filtered
      .map(
        (t) => {
          const isHidden = hiddenSet.has(t.topicUrl);
          const isFav = matchesFavActress(t, favActresses);
          const extraClass = isFav ? " result-card--fav" : "";
          return `
      <div class="result-card${isHidden ? " result-card--hidden" : ""}${extraClass}" data-url="${esc(t.topicUrl)}" data-title="${esc(t.title)}">
        ${t.postImage ? `<img class="result-thumb" src="${esc(t.postImage)}" alt="" loading="lazy" onerror="this.style.display='none'" />` : ""}
        <div class="result-info">
          <div class="result-title"><a href="${esc(t.topicUrl)}" target="_blank">${isFav ? "★ " : ""}${esc(t.title)}</a></div>
          <div class="result-meta">
            ${t.starring ? `<span><span class="label">Cast:</span> <span class="value">${esc(t.starring)}</span></span>` : ""}
            ${t.productionDate ? `<span><span class="label">Date:</span> <span class="value">${esc(t.productionDate)}</span></span>` : ""}
            ${t.duration ? `<span><span class="label">Duration:</span> <span class="value">${esc(t.duration)}</span></span>` : ""}
            ${t.size ? `<span><span class="label">Size:</span> <span class="value">${esc(t.size)}</span></span>` : ""}
          </div>
          <div class="result-actions">
            <div class="result-actions-menu-wrapper">
              <button class="btn btn-small btn-menu-trigger" data-action="menu">⋯</button>
              <div class="popup-menu" data-popup-menu>
                <button class="popup-menu-item" data-action="reload-details">🔄 Reload details</button>
                <button class="popup-menu-item danger" data-action="delete-from-db">🗑 Delete from DB</button>
              </div>
            </div>
            ${t.torrentUrl ? `<a class="btn btn-small" href="${esc(t.torrentUrl)}" target="_blank">⬇ Torrent</a>` : ""}
            ${t.postImage ? `<button class="btn btn-small" data-action="screens">🖼 Screens</button>` : ""}
            <button class="btn btn-small btn-hide" data-action="hide">${isHidden ? "👁 Show" : "🙈 Hide"}</button>
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
  const btn = e.target.closest("[data-action='hide']");
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

  if (action === "reload-details") {
    await reloadTopicDetails(topicUrl, title, card);
  } else if (action === "delete-from-db") {
    await deleteTopicFromDb(topicUrl, card);
  }
});

async function reloadTopicDetails(topicUrl, title, card) {
  if (!confirm(`Reload details for "${title}"?`)) return;

  try {
    const res = await fetch("/api/results/reload-details", {
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
          if (infoDiv && data.details) {
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
            if (data.details.postImage) {
              const thumb = card.querySelector(".result-thumb");
              if (thumb) {
                thumb.src = data.details.postImage;
              } else if (!card.querySelector(".result-thumb")) {
                // Add a thumbnail if there wasn't one
                const img = document.createElement("img");
                img.className = "result-thumb";
                img.src = data.details.postImage;
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
        if (valEl) valEl.textContent = value;
        found = true;
      } else {
        // Remove the span if value is now null
        span.remove();
        found = true;
      }
      break;
    }
  }
  // If not found and value exists, add it
  if (!found && value) {
    const newSpan = document.createElement("span");
    newSpan.innerHTML = `<span class="label">${label}</span> <span class="value">${esc(value)}</span>`;
    metaDiv.appendChild(newSpan);
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
      const countEl = document.getElementById("result-count");
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

// --- Image Carousel ---

let carouselImages = [];
let carouselIndex = 0;

const modalOverlay = document.getElementById("image-modal");
const modalTitle = document.getElementById("modal-title");
const modalClose = document.getElementById("modal-close");
const carouselImg = document.getElementById("carousel-image");
const carouselLoading = document.getElementById("carousel-loading");
const carouselPrev = document.getElementById("carousel-prev");
const carouselNext = document.getElementById("carousel-next");
const carouselCounter = document.getElementById("carousel-counter");
const carouselThumbnails = document.getElementById("carousel-thumbnails");

modalClose.addEventListener("click", closeCarousel);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeCarousel();
});
document.addEventListener("keydown", (e) => {
  if (!modalOverlay || modalOverlay.hidden) return;
  if (e.key === "Escape") closeCarousel();
  if (e.key === "ArrowLeft") showCarouselImage(carouselIndex - 1);
  if (e.key === "ArrowRight") showCarouselImage(carouselIndex + 1);
});
carouselPrev.addEventListener("click", () => showCarouselImage(carouselIndex - 1));
carouselNext.addEventListener("click", () => showCarouselImage(carouselIndex + 1));
carouselImg.addEventListener("click", () => {
  if (carouselImages[carouselIndex]?.resolvedUrl) {
    window.open(carouselImages[carouselIndex].resolvedUrl, "_blank");
  }
});

function closeCarousel() {
  modalOverlay.hidden = true;
  carouselImages = [];
  carouselIndex = 0;
}

async function openImageCarousel(topicUrl, title) {
  modalOverlay.hidden = false;
  modalTitle.textContent = `📷 ${title}`;
  carouselImg.src = "";
  carouselImg.style.display = "none";
  carouselLoading.hidden = false;
  carouselThumbnails.innerHTML = "";
  carouselCounter.textContent = "";
  carouselPrev.disabled = true;
  carouselNext.disabled = true;

  const progressText = document.getElementById("carousel-progress-text");
  const progressBarContainer = document.getElementById("carousel-progress-bar-container");
  const progressBar = document.getElementById("carousel-progress-bar");
  progressText.textContent = "Scraping topic images...";
  progressBar.style.width = "0%";
  progressBarContainer.hidden = true;

  function processLines(text) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = JSON.parse(line.slice(6));

      if (data.phase === "scraping") {
        progressText.textContent = data.message;
        progressBarContainer.hidden = true;
      } else if (data.phase === "resolving") {
        progressText.textContent = data.message;
        progressBarContainer.hidden = false;
        const pct = Math.round((data.current / data.total) * 100);
        progressBar.style.width = pct + "%";
      } else if (data.phase === "done") {
        if (!data.images || data.images.length === 0) {
          progressText.textContent = "No images found from supported hosts.";
          progressBarContainer.hidden = true;
          return true;
        }
        carouselImages = data.images;
        renderCarouselThumbnails();
        showCarouselImage(0);
        carouselLoading.hidden = true;
        return true;
      } else if (data.phase === "error") {
        progressText.textContent = `Error: ${data.message}`;
        progressBarContainer.hidden = true;
        return true;
      }
    }
    return false;
  }

  try {
    const res = await fetch("/api/topic/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicUrl }),
    });

    // Stream SSE events from the response
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Process any remaining data left in the buffer
        if (buffer.trim()) processLines(buffer);
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines, keep incomplete last line in buffer
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      if (processLines(lines.join("\n"))) return;
    }
  } catch (err) {
    progressText.textContent = `Error: ${err.message}`;
  }
}

function renderCarouselThumbnails() {
  carouselThumbnails.innerHTML = "";
  carouselImages.forEach((img, i) => {
    const thumb = document.createElement("img");
    thumb.className = "carousel-thumb" + (i === 0 ? " active" : "");
    // Use thumbnailUrl (the <img src> from the post) for carousel thumbnails
    thumb.src = img.thumbnailUrl || img.originalUrl;
    thumb.alt = `Thumb ${i + 1}`;
    thumb.loading = "lazy";
    thumb.addEventListener("click", () => showCarouselImage(i));
    carouselThumbnails.appendChild(thumb);
  });
}

function showCarouselImage(index) {
  if (carouselImages.length === 0) return;

  // Clamp index
  index = Math.max(0, Math.min(index, carouselImages.length - 1));
  carouselIndex = index;

  const img = carouselImages[index];
  carouselImg.src = img.resolvedUrl;
  carouselImg.style.display = "block";
  carouselLoading.hidden = true;

  // Update counter
  carouselCounter.textContent = `${index + 1} / ${carouselImages.length}`;

  // Update buttons
  carouselPrev.disabled = index === 0;
  carouselNext.disabled = index === carouselImages.length - 1;

  // Update active thumbnail
  const thumbs = carouselThumbnails.querySelectorAll(".carousel-thumb");
  thumbs.forEach((t, i) => {
    t.classList.toggle("active", i === index);
    if (i === index) {
      t.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  });
}

// --- Helpers ---

function esc(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function showStatus(el, msg, isError) {
  el.textContent = msg;
  el.className = "status-msg " + (isError ? "error" : "success");
  setTimeout(() => {
    el.textContent = "";
    el.className = "status-msg";
  }, 3000);
}

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
          if (data.phase === "captcha-needed" && data.captcha) {
            captchaActiveId = data.captcha.captchaId;
            showCaptchaModal(data.captcha.imageBase64);
          } else if (data.phase === "result") {
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
          } else if (data.phase === "captcha-needed" && data.captcha) {
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
  const favActresses =
    config && config.favActresses ? config.favActresses : [];

  showStatus(searchStatus, `${topics.length} results found`, false);

  searchResultsContainer.innerHTML = topics
    .map((t, idx) => {
      const isFav = matchesFavActress(t, favActresses);
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
            ${t.sourceForum ? `<span><span class="label">Forum:</span> <span class="value">${esc(t.sourceForum)}</span></span>` : ""}
            ${t.starring ? `<span class="detail-starring"><span class="label">Cast:</span> <span class="value">${esc(t.starring)}</span></span>` : ""}
            ${t.productionDate ? `<span class="detail-date"><span class="label">Date:</span> <span class="value">${esc(t.productionDate)}</span></span>` : ""}
            ${t.duration ? `<span class="detail-duration"><span class="label">Duration:</span> <span class="value">${esc(t.duration)}</span></span>` : ""}
            ${t.size ? `<span><span class="label">Size:</span> <span class="value">${esc(t.size)}</span></span>` : ""}
          </div>
          <div class="result-actions">
            ${t.torrentUrl ? `<a class="btn btn-small" href="${esc(t.torrentUrl)}" target="_blank">⬇ Torrent</a>` : ""}
            <button class="btn btn-small" data-action="search-screens" ${t.postImage ? "" : 'style="display:none"'}>🖼 Screens</button>
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
            if (data.phase === "captcha-needed" && data.captcha) {
              captchaActiveId = data.captcha.captchaId;
              showCaptchaModal(data.captcha.imageBase64);
            } else if (data.phase === "result") {
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
          meta.appendChild(span);
        }
        if (details.productionDate && !meta.querySelector(".detail-date")) {
          const span = document.createElement("span");
          span.className = "detail-date";
          span.innerHTML = `<span class="label">Date:</span> <span class="value">${esc(details.productionDate)}</span>`;
          meta.appendChild(span);
        }
        if (details.duration && !meta.querySelector(".detail-duration")) {
          const span = document.createElement("span");
          span.className = "detail-duration";
          span.innerHTML = `<span class="label">Duration:</span> <span class="value">${esc(details.duration)}</span>`;
          meta.appendChild(span);
        }
      }

      // Show Screens button now that we have an image
      if (details.postImage) {
        const screensBtn = card.querySelector('[data-action="search-screens"]');
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
      const res = await fetch("/api/results/add", {
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
  const screensBtn = e.target.closest("[data-action='search-screens']");
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

// --- Init ---
loadConfig();
connectSSE();
loadForums();
