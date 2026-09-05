const forumsList = document.getElementById("forums-list");
const btnAddForum = document.getElementById("btn-add-forum");
const btnSaveConfig = document.getElementById("btn-save-config");
const btnClearDb = document.getElementById("btn-clear-db");
const btnClearTurboImageHostCookies = document.getElementById("btn-clear-turboimagehost-cookies");
const configStatus = document.getElementById("config-status");

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
  document.getElementById("cfg-mcp-enabled").checked = config.mcp?.enabled ?? false;
  document.getElementById("cfg-mcp-endpoint").textContent = `${window.location.origin}/mcp`;
  renderForums();
}

function collectForm() {
  config.credentials.username = document.getElementById("cfg-username").value;
  config.credentials.password = document.getElementById("cfg-password").value;
  config.pagesToScan = parseInt(document.getElementById("cfg-pages").value, 10) || 2;
  config.headless = document.getElementById("cfg-headless").checked;
  config.delay = {
    min: parseInt(document.getElementById("cfg-delay-min").value, 10) || 2000,
    max: parseInt(document.getElementById("cfg-delay-max").value, 10) || 5000,
  };
  config.screenshotCache = {
    maxSizeMB: Math.max(0, parseInt(document.getElementById("cfg-cache-max-size").value, 10) || 0),
  };
  config.mcp = {
    enabled: document.getElementById("cfg-mcp-enabled").checked,
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

document.getElementById("cfg-headless").addEventListener("change", collectForm);

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

btnClearTurboImageHostCookies.addEventListener("click", async () => {
  if (!confirm("Clear TurboImageHost cookies, local storage, and cache? This closes any active verification window and cancels its current image resolution. Your app settings, Pornolab login, saved results, and screenshot cache will not be changed.")) return;
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
    showStatus(configStatus, "CSV exported!", false);
  } catch (err) {
    showStatus(configStatus, err.message, true);
  }
});

loadConfig();
