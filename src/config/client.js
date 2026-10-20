const forumsList = document.getElementById("forums-list");
const btnAddForum = document.getElementById("btn-add-forum");
const btnClearHiddenResults = document.getElementById("btn-clear-hidden-results");
const btnClearTurboImageHostCookies = document.getElementById("btn-clear-turboimagehost-cookies");
const screenTimeIndicator = document.getElementById("screen-time-indicator");
const screenTimeEnabledToggle = document.getElementById("cfg-screen-time-enabled");
const configStatus = document.getElementById("config-status");
let configSaveQueue = Promise.resolve();

function updateScreenTimeVisibility() {
  screenTimeIndicator.hidden = !(config?.screenTime?.enabled ?? true);
}

function renderForums() {
  forumsList.innerHTML = "";
  if (!config) return;
  config.forums.forEach((forum, index) => {
    const div = document.createElement("div");
    div.className = "forum-entry";
    div.innerHTML = `
      <input type="text" value="${esc(forum.label)}" data-field="label" placeholder="Label" style="flex: 0.6" />
      <input type="url" value="${esc(forum.url)}" data-field="url" placeholder="Forum URL" />
      <button class="btn btn-small" data-remove>✕</button>
    `;
    div.querySelector('[data-field="label"]').addEventListener("input", (event) => {
      config.forums[index].label = event.target.value;
    });
    div.querySelector('[data-field="url"]').addEventListener("input", (event) => {
      config.forums[index].url = event.target.value;
    });
    div.querySelector("[data-remove]").addEventListener("click", () => {
      config.forums.splice(index, 1);
      renderForums();
    });
    forumsList.appendChild(div);
  });
}

function fillForm() {
  if (!config) return;
  document.getElementById("cfg-username").value = config.credentials.username;
  document.getElementById("cfg-password").value = config.credentials.password;
  document.getElementById("cfg-pages").value = config.pagesToScan;
  document.getElementById("cfg-headless").checked = config.headless;
  document.getElementById("cfg-delay-min").value = config.delay?.min ?? 2000;
  document.getElementById("cfg-delay-max").value = config.delay?.max ?? 5000;
  document.getElementById("cfg-cache-max-size").value = config.screenshotCache?.maxSizeMB ?? 200;
  screenTimeEnabledToggle.checked = config.screenTime?.enabled ?? true;
  updateScreenTimeVisibility();
  document.getElementById("cfg-duplicate-hiding-enabled").checked = config.duplicateHiding?.enabled ?? true;
  document.getElementById("cfg-duplicate-hiding-quality").value = config.duplicateHiding?.preferredQuality ?? "1080p";
  document.getElementById("cfg-mcp-enabled").checked = config.mcp?.enabled ?? false;
  document.getElementById("cfg-mcp-port").value = config.mcp?.port ?? 3002;
  updateMcpEndpoint();
  renderForums();
}

function updateMcpEndpoint() {
  document.getElementById("cfg-mcp-endpoint").value = `http://localhost:${config.mcp?.port ?? 3002}/mcp`;
}

function collectConfigPanel(panel) {
  switch (panel) {
    case "credentials":
      return { credentials: {
        username: document.getElementById("cfg-username").value,
        password: document.getElementById("cfg-password").value,
      } };
    case "screen-time":
      return { screenTime: { enabled: screenTimeEnabledToggle.checked } };
    case "duplicates":
      return { duplicateHiding: {
        enabled: document.getElementById("cfg-duplicate-hiding-enabled").checked,
        preferredQuality: document.getElementById("cfg-duplicate-hiding-quality").value,
      } };
    case "delay":
      return { delay: {
        min: parseInt(document.getElementById("cfg-delay-min").value, 10) || 2000,
        max: parseInt(document.getElementById("cfg-delay-max").value, 10) || 5000,
      } };
    case "cache":
      return { screenshotCache: {
        maxSizeMB: Math.max(0, parseInt(document.getElementById("cfg-cache-max-size").value, 10) || 0),
      } };
    case "mcp":
      return { mcp: { enabled: document.getElementById("cfg-mcp-enabled").checked, port: Number(document.getElementById("cfg-mcp-port").value) } };
    case "crawl":
      return {
        forums: config.forums.map((forum) => ({ ...forum })),
        pagesToScan: parseInt(document.getElementById("cfg-pages").value, 10) || 2,
        headless: document.getElementById("cfg-headless").checked,
      };
    default:
      throw new Error("Unknown settings panel");
  }
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

// Read the latest saved settings and replace only this panel's fields. Serialize
// saves so two panels saved together cannot overwrite each other's changes.
async function saveConfigPanel(panel) {
  if (!config) throw new Error(t("Settings are still loading. Please try again."));
  const patch = collectConfigPanel(panel);
  const save = configSaveQueue.then(async () => {
    const latest = await fetch("/api/config");
    if (!latest.ok) throw new Error(t("Failed to load config"));
    const saved = await latest.json();
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...saved, ...patch }),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || t("Save failed"));
    }
    if (panel === "screen-time") {
      config.screenTime = patch.screenTime;
      updateScreenTimeVisibility();
    }
    if (panel === "mcp") { config.mcp = patch.mcp; updateMcpEndpoint(); }
  });
  configSaveQueue = save.catch(() => {});
  await save;
}

for (const panel of ["credentials", "duplicates", "delay", "cache"]) {
  const button = document.getElementById(`btn-save-${panel}`);
  const status = document.getElementById(`config-${panel}-status`);
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await saveConfigPanel(panel);
      showStatus(status, t("Settings saved."), false);
    } catch (err) {
      showStatus(status, err.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

for (const [panel, inputId, field] of [
  ["screen-time", "cfg-screen-time-enabled", "screenTime"],
  ["mcp", "cfg-mcp-enabled", "mcp"],
]) {
  const control = document.getElementById(inputId);
  const status = document.getElementById(`config-${panel}-status`);
  control.addEventListener("change", async () => {
    const previous = config?.[field]?.enabled ?? (panel === "screen-time");
    control.disabled = true;
    if (panel === "mcp") document.getElementById("cfg-mcp-port").disabled = true;
    try {
      await saveConfigPanel(panel);
      showStatus(status, t("Settings saved."), false);
    } catch (err) {
      control.checked = previous;
      showStatus(status, err.message, true);
    } finally {
      control.disabled = false;
      if (panel === "mcp") document.getElementById("cfg-mcp-port").disabled = false;
    }
  });
}

document.getElementById("cfg-mcp-port").addEventListener("change", async () => {
  const control = document.getElementById("cfg-mcp-port");
  const toggle = document.getElementById("cfg-mcp-enabled");
  control.disabled = true;
  toggle.disabled = true;
  try {
    await saveConfigPanel("mcp");
    showStatus(document.getElementById("config-mcp-status"), t("Settings saved."), false);
  } catch (err) {
    control.value = config.mcp?.port ?? 3002;
    showStatus(document.getElementById("config-mcp-status"), err.message, true);
  } finally { control.disabled = false; toggle.disabled = false; }
});

btnClearHiddenResults.addEventListener("click", async () => {
  if (!confirm(t("Are you sure you want to delete ALL hidden topics from the database? This cannot be undone."))) return;
  try {
    const res = await fetch("/api/results/hidden", { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to clear hidden results");
    const data = await res.json();
    showStatus(configStatus, data.message, false);
  } catch (err) {
    showStatus(configStatus, err.message, true);
  }
});

btnClearTurboImageHostCookies.addEventListener("click", async () => {
  if (!confirm(t("Clear TurboImageHost cookies, local storage, and cache? This closes any active verification window and cancels its current image resolution. Your app settings, Pornolab login, saved results, and screenshot cache will not be changed."))) return;
  btnClearTurboImageHostCookies.disabled = true;
  try {
    const res = await fetch("/api/config/turboimagehost/verification-data", { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to clear TurboImageHost cookies");
    const data = await res.json();
    showStatus(configStatus, data.message, false);
  } catch (err) {
    showStatus(configStatus, err.message, true);
  } finally {
    btnClearTurboImageHostCookies.disabled = false;
  }
});

document.getElementById("btn-export-csv").addEventListener("click", async () => {
  try {
    const res = await fetch("/api/results/export");
    if (!res.ok) throw new Error("Failed to export");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `topics-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showStatus(configStatus, t("CSV exported!"), false);
  } catch (err) {
    showStatus(configStatus, err.message, true);
  }
});


// Tags live on items, so edits here update both libraries rather than config.json.
const configTagsList = document.getElementById("config-tags-list");
const configTagsStatus = document.getElementById("config-tags-status");
const btnRefreshConfigTags = document.getElementById("btn-refresh-config-tags");
let configTagsBusy = false;

function configTagPickerHex(color) {
  if (!color) return "#6366f1";
  const probe = document.createElement("span");
  probe.style.color = color;
  document.body.appendChild(probe);
  const rgb = parseColor(getComputedStyle(probe).color);
  probe.remove();
  return rgb ? "#" + [rgb.r, rgb.g, rgb.b].map((channel) =>
    Math.round(channel).toString(16).padStart(2, "0"),
  ).join("") : "#6366f1";
}

function renderConfigTagRow(tag) {
  const row = document.createElement("form");
  row.className = "config-tag-row";
  row.innerHTML = `
    <div class="config-tag-preview"></div>
    <input type="text" value="${esc(tag.name)}" aria-label="${esc(t("Tag name"))}" required />
    <label class="config-tag-color">${esc(t("Tag color"))}<input type="color" aria-label="${esc(t("Pick a custom color"))}" /></label>
    <label class="config-tag-color"><span class="toggle"><input type="checkbox" role="switch" /><span class="slider" aria-hidden="true"></span></span>${esc(t("No color"))}</label>
    <button class="btn btn-small btn-primary" type="submit">${esc(t("💾 Save"))}</button>
    <button class="btn btn-small btn-danger" type="button" data-delete>${esc(t("🗑 Delete"))}</button>
  `;
  const nameInput = row.querySelector('input[type="text"]');
  const colorInput = row.querySelector('input[type="color"]');
  const noColorInput = row.querySelector('input[type="checkbox"]');
  const preview = row.querySelector(".config-tag-preview");
  let selectedColor = tag.color;
  colorInput.value = configTagPickerHex(selectedColor);
  noColorInput.checked = !selectedColor;

  function updatePreview() {
    const chip = document.createElement("span");
    chip.className = "tag-chip" + (selectedColor ? " tag-chip--colored" : "");
    chip.textContent = nameInput.value.trim() || tag.name;
    if (selectedColor) {
      chip.style.setProperty("--tag-color", selectedColor);
      chip.style.setProperty("--tag-fg", contrastFg(selectedColor));
    }
    preview.replaceChildren(chip);
  }
  nameInput.addEventListener("input", updatePreview);
  colorInput.addEventListener("input", () => {
    selectedColor = colorInput.value;
    noColorInput.checked = false;
    updatePreview();
  });
  noColorInput.addEventListener("change", () => {
    selectedColor = noColorInput.checked ? null : colorInput.value;
    updatePreview();
  });
  row.addEventListener("submit", (event) => {
    event.preventDefault();
    saveConfigTag(row, tag.name, { newName: nameInput.value.trim(), color: selectedColor });
  });
  row.querySelector("[data-delete]").addEventListener("click", () => {
    if (confirm(t('Delete tag "{tag}" from all Results and Downloaded items? This cannot be undone.', { tag: tag.name }))) {
      saveConfigTag(row, tag.name, null);
    }
  });
  updatePreview();
  return row;
}

function renderConfigTagsEmpty() {
  configTagsList.innerHTML = `<p class="empty-state">${esc(t("No tags yet. Add a tag to an item in Results or Downloaded."))}</p>`;
}

async function loadConfigTags() {
  if (configTagsBusy) return;
  configTagsBusy = true;
  btnRefreshConfigTags.disabled = true;
  configTagsList.setAttribute("aria-busy", "true");
  try {
    const res = await fetch("/api/config/tags");
    if (!res.ok) throw new Error(t("Failed to load tags"));
    const data = await res.json();
    configTagsList.replaceChildren(...data.tags.map(renderConfigTagRow));
    if (!data.tags.length) renderConfigTagsEmpty();
    configTagsStatus.textContent = "";
  } catch (err) {
    showStatus(configTagsStatus, err.message, true);
  } finally {
    configTagsBusy = false;
    btnRefreshConfigTags.disabled = false;
    configTagsList.setAttribute("aria-busy", "false");
  }
}

async function saveConfigTag(row, name, replacement) {
  if (configTagsBusy) return;
  configTagsBusy = true;
  btnRefreshConfigTags.disabled = true;
  const controls = Array.from(configTagsList.querySelectorAll("input, button"));
  controls.forEach((control) => { control.disabled = true; });
  configTagsList.setAttribute("aria-busy", "true");
  try {
    const res = await fetch("/api/config/tags", {
      method: replacement ? "PATCH" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ...replacement }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(t(data.error || "Failed to update tag"));
    if (replacement) {
      row.replaceWith(renderConfigTagRow(data.tags.find((tag) =>
        tag.name.toLowerCase() === replacement.newName.toLowerCase(),
      )));
    } else {
      row.remove();
      if (!data.tags.length) renderConfigTagsEmpty();
    }
    resultsTagFilter.replaceFilter(name, replacement?.newName);
    downloadedTagFilter.replaceFilter(name, replacement?.newName);
    allResultsKnownTags = data.tags;
    allKnownTags = data.tags;
    resultsTagFilter.setKnownTags(data.tags);
    downloadedTagFilter.setKnownTags(data.tags);
    await Promise.all([loadResults(), loadDownloadedItems()]);
    showStatus(configTagsStatus, t(replacement ? "Tag updated across Results and Downloaded." : "Tag deleted from Results and Downloaded."), false);
  } catch (err) {
    showStatus(configTagsStatus, err.message, true);
  } finally {
    controls.forEach((control) => { control.disabled = false; });
    configTagsBusy = false;
    btnRefreshConfigTags.disabled = false;
    configTagsList.setAttribute("aria-busy", "false");
  }
}

btnRefreshConfigTags.addEventListener("click", loadConfigTags);
loadConfigTags();
