const forumsList = document.getElementById("forums-list");
const btnAddForum = document.getElementById("btn-add-forum");
const btnSaveConfig = document.getElementById("btn-save-config");
const btnClearDb = document.getElementById("btn-clear-db");
const configStatus = document.getElementById("config-status");
const cfgAiEnabled = document.getElementById("cfg-ai-enabled");
const cfgAiProvider = document.getElementById("cfg-ai-provider");
const aiOllamaFields = document.getElementById("ai-ollama-fields");
const aiOpenrouterFields = document.getElementById("ai-openrouter-fields");
const rulesList = document.getElementById("ai-rules-list");
const btnAddRule = document.getElementById("btn-add-rule");
const aiScoringCard = document.getElementById("ai-scoring-card");
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

// --- AI Topic Rating ---

function renderAiFields() {
  if (!config) return;
  const enabled = config.ai.enabled;
  const provider = config.ai.provider;
  aiOllamaFields.classList.toggle("field-group--disabled", !enabled || provider !== "ollama");
  aiOpenrouterFields.classList.toggle("field-group--disabled", !enabled || provider !== "openrouter");
  cfgAiProvider.disabled = !enabled;
  aiOllamaFields.hidden = provider !== "ollama";
  aiOpenrouterFields.hidden = provider !== "openrouter";
  aiScoringCard.classList.toggle("field-group--disabled", !enabled);
}

// --- AI Scoring Rules ---
// Mirrors the closed enums in src/core/types.ts (HairColor, HairLength,
// BodyType, AgeBracket, Race, BreastSize) — keep in sync manually if those
// change. "unknown" is deliberately omitted: scoring against "the model
// couldn't tell" isn't a meaningful rule.
const PERFORMER_CHARACTERISTIC_OPTIONS = [
  { label: "Hair color", values: ["blonde", "brunette", "black", "red", "colorful"] },
  { label: "Hair length", values: ["bald", "short", "shoulder-length", "long"] },
  { label: "Body type", values: ["slim", "athletic", "average", "curvy", "bbw", "muscular"] },
  { label: "Age", values: ["18-22", "23-27", "28-35", "36-45", "46+"] },
  { label: "Race", values: ["asian", "ebony", "caucasian", "latina", "middle-eastern", "mixed"] },
  { label: "Breast size", values: ["small", "medium", "large", "extra-large"] },
];

// Cached actress catalogue for the "actress" rule type's value dropdown —
// unlike PERFORMER_CHARACTERISTIC_OPTIONS this is user data, not a fixed
// enum, so it's fetched rather than hardcoded. Re-renders the rule list
// once loaded so rows opened before the fetch resolved still get options.
let allActresses = [];
async function loadKnownActresses() {
  try {
    const res = await fetch("/api/actresses");
    if (res.ok) allActresses = await res.json();
  } catch {
    allActresses = [];
  } finally {
    if (config) renderRules();
  }
}
loadKnownActresses();

function renderRules() {
  rulesList.innerHTML = "";
  if (!config) return;
  config.ai.scoring.rules.forEach((rule, i) => {
    const div = document.createElement("div");
    div.className = "rule-entry";
    let valueField;
    if (rule.type === "tag") {
      valueField = `<input type="text" data-field="value" placeholder="e.g. anal" value="${esc(rule.value)}" />`;
    } else if (rule.type === "performer-characteristic") {
      valueField = `<select data-field="value">${PERFORMER_CHARACTERISTIC_OPTIONS.map(
        (group) =>
          `<optgroup label="${esc(group.label)}">${group.values
            .map((v) => `<option value="${esc(v)}"${v === rule.value ? " selected" : ""}>${esc(v)}</option>`)
            .join("")}</optgroup>`,
      ).join("")}</select>`;
    } else {
      const actressOptions = allActresses
        .map(
          (a) =>
            `<option value="${esc(a.name)}"${a.name === rule.value ? " selected" : ""}>${a.isFavorite ? "★ " : ""}${esc(a.name)}</option>`,
        )
        .join("");
      valueField = `<select data-field="value">
        <option value="favorite"${rule.value === "favorite" ? " selected" : ""}>★ Favorite (any)</option>
        <option value="saved"${rule.value === "saved" ? " selected" : ""}>Saved (any known actress)</option>
        ${actressOptions ? `<optgroup label="Specific actress">${actressOptions}</optgroup>` : ""}
      </select>`;
    }
    div.innerHTML = `
      <select data-field="type">
        <option value="tag"${rule.type === "tag" ? " selected" : ""}>Tag contains</option>
        <option value="performer-characteristic"${rule.type === "performer-characteristic" ? " selected" : ""}>Performer characteristic</option>
        <option value="actress"${rule.type === "actress" ? " selected" : ""}>Actress</option>
      </select>
      <span data-value-slot></span>
      <input type="number" data-field="weight" min="-1" max="1" step="0.1" value="${rule.weight}" />
      <button class="btn btn-small" data-remove="${i}">✕</button>
    `;
    div.querySelector("[data-value-slot]").outerHTML = valueField;
    div.querySelector(`[data-field="type"]`).addEventListener("change", (e) => {
      const newType = e.target.value;
      const defaultValue =
        newType === "tag" ? "" : newType === "performer-characteristic" ? PERFORMER_CHARACTERISTIC_OPTIONS[0].values[0] : "favorite";
      config.ai.scoring.rules[i] = { type: newType, value: defaultValue, weight: rule.weight };
      renderRules();
    });
    div.querySelector(`[data-field="value"]`).addEventListener(rule.type === "tag" ? "input" : "change", (e) => {
      config.ai.scoring.rules[i].value = e.target.value;
    });
    div.querySelector(`[data-field="weight"]`).addEventListener("input", (e) => {
      const num = parseFloat(e.target.value);
      config.ai.scoring.rules[i].weight = Number.isFinite(num) ? Math.max(-1, Math.min(1, num)) : 0;
    });
    div.querySelector(`[data-remove]`).addEventListener("click", () => {
      config.ai.scoring.rules.splice(i, 1);
      renderRules();
    });
    rulesList.appendChild(div);
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
  cfgAiEnabled.checked = config.ai.enabled;
  cfgAiProvider.value = config.ai.provider;
  document.getElementById("cfg-ai-ollama-url").value = config.ai.ollama.baseUrl;
  document.getElementById("cfg-ai-ollama-text-model").value = config.ai.ollama.textModel;
  document.getElementById("cfg-ai-ollama-vision-model").value = config.ai.ollama.visionModel;
  document.getElementById("cfg-ai-openrouter-key").value = config.ai.openrouter.apiKey;
  document.getElementById("cfg-ai-openrouter-text-model").value = config.ai.openrouter.textModel;
  document.getElementById("cfg-ai-openrouter-vision-model").value = config.ai.openrouter.visionModel;
  renderAiFields();
  renderForums();
  renderRules();
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
  config.ai.enabled = cfgAiEnabled.checked;
  config.ai.provider = cfgAiProvider.value;
  config.ai.ollama.baseUrl = document.getElementById("cfg-ai-ollama-url").value.trim();
  config.ai.ollama.textModel = document.getElementById("cfg-ai-ollama-text-model").value.trim();
  config.ai.ollama.visionModel = document.getElementById("cfg-ai-ollama-vision-model").value.trim();
  config.ai.openrouter.apiKey = document.getElementById("cfg-ai-openrouter-key").value;
  config.ai.openrouter.textModel = document.getElementById("cfg-ai-openrouter-text-model").value.trim();
  config.ai.openrouter.visionModel = document.getElementById("cfg-ai-openrouter-vision-model").value.trim();
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

btnAddRule.addEventListener("click", () => {
  if (!config) return;
  config.ai.scoring.rules.push({ type: "tag", value: "", weight: 0 });
  renderRules();
});

// --- AI Scoring Rules: "Calculate by Downloads" ---
// Samples random downloaded items, runs the title/screenshot AI analyzers
// on each, and turns tag/characteristic frequency across the sample into
// suggested rules (no AI involved in that last step — see
// src/ai/rule-suggester.ts). Replaces config.ai.scoring.rules in-memory,
// same as every other edit on this tab — still requires Save Config to
// persist.
const btnCalcRulesByDownloads = document.getElementById("btn-calc-rules-by-downloads");
const aiSuggestRulesModal = document.getElementById("ai-suggest-rules-modal");
const aiSuggestRulesClose = document.getElementById("ai-suggest-rules-close");
const aiSuggestRulesCancel = document.getElementById("ai-suggest-rules-cancel");
const aiSuggestRulesRun = document.getElementById("ai-suggest-rules-run");
const aiSuggestRulesCount = document.getElementById("ai-suggest-rules-count");
const aiSuggestRulesCountLabel = document.getElementById("ai-suggest-rules-count-label");
const aiSuggestRulesRuleCount = document.getElementById("ai-suggest-rules-rule-count");
const aiSuggestRulesStatus = document.getElementById("ai-suggest-rules-status");
const aiSuggestRulesProgressContainer = document.getElementById("ai-suggest-rules-progress-container");
const aiSuggestRulesProgressBar = document.getElementById("ai-suggest-rules-progress-bar");
const aiSuggestRulesLog = document.getElementById("ai-suggest-rules-log");
let aiSuggestRulesInFlight = false;

async function openAiSuggestRulesModal() {
  aiSuggestRulesStatus.textContent = "Loading downloaded items...";
  aiSuggestRulesStatus.className = "status-msg";
  aiSuggestRulesProgressContainer.hidden = true;
  aiSuggestRulesProgressBar.style.width = "0%";
  aiSuggestRulesLog.style.display = "none";
  aiSuggestRulesLog.textContent = "";
  aiSuggestRulesRun.disabled = true;
  aiSuggestRulesRun.textContent = "▶ Run";
  aiSuggestRulesCancel.disabled = false;
  aiSuggestRulesCancel.textContent = "Cancel";
  aiSuggestRulesModal.hidden = false;

  try {
    const res = await fetch("/api/downloaded");
    if (!res.ok) throw new Error("Failed to load downloaded items");
    const items = await res.json();
    const eligible = items.filter((i) => !!i.topicUrl).length;
    if (eligible === 0) {
      aiSuggestRulesStatus.textContent = "No downloaded items with a matched topic URL to analyze.";
      aiSuggestRulesStatus.className = "status-msg error";
      aiSuggestRulesCount.max = 1;
      aiSuggestRulesCount.value = 1;
      aiSuggestRulesCountLabel.textContent = "1";
      return;
    }
    aiSuggestRulesCount.max = eligible;
    aiSuggestRulesCount.value = Math.min(10, eligible);
    aiSuggestRulesCountLabel.textContent = aiSuggestRulesCount.value;
    aiSuggestRulesStatus.textContent = `${eligible} downloaded item(s) available to sample from.`;
    aiSuggestRulesStatus.className = "status-msg";
    aiSuggestRulesRun.disabled = false;
  } catch (err) {
    aiSuggestRulesStatus.textContent = `Error: ${err.message}`;
    aiSuggestRulesStatus.className = "status-msg error";
  }
}

function closeAiSuggestRulesModal() {
  if (aiSuggestRulesInFlight) return;
  aiSuggestRulesModal.hidden = true;
}

btnCalcRulesByDownloads.addEventListener("click", openAiSuggestRulesModal);
aiSuggestRulesClose.addEventListener("click", closeAiSuggestRulesModal);
aiSuggestRulesCancel.addEventListener("click", closeAiSuggestRulesModal);
aiSuggestRulesModal.addEventListener("click", (e) => {
  if (e.target === aiSuggestRulesModal) closeAiSuggestRulesModal();
});
aiSuggestRulesCount.addEventListener("input", () => {
  aiSuggestRulesCountLabel.textContent = aiSuggestRulesCount.value;
});

function appendAiSuggestRulesLog(text) {
  aiSuggestRulesLog.textContent += text + "\n";
  aiSuggestRulesLog.scrollTop = aiSuggestRulesLog.scrollHeight;
}

aiSuggestRulesRun.addEventListener("click", async () => {
  if (!config) return;
  const count = parseInt(aiSuggestRulesCount.value, 10) || 1;
  const ruleCount = parseInt(aiSuggestRulesRuleCount.value, 10) || 1;

  aiSuggestRulesInFlight = true;
  aiSuggestRulesRun.disabled = true;
  aiSuggestRulesCancel.disabled = true;
  aiSuggestRulesCount.disabled = true;
  aiSuggestRulesRuleCount.disabled = true;
  aiSuggestRulesProgressContainer.hidden = false;
  aiSuggestRulesProgressBar.style.width = "0%";
  aiSuggestRulesLog.style.display = "block";
  aiSuggestRulesLog.textContent = "";
  aiSuggestRulesStatus.textContent = "Starting...";
  aiSuggestRulesStatus.className = "status-msg";

  try {
    const res = await fetch("/api/config/ai/suggest-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count, ruleCount }),
    });

    if (!res.body) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${res.status})`);
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
        const data = JSON.parse(line.slice(6));
        if (data.phase === "start") {
          appendAiSuggestRulesLog(`▶ ${data.message}`);
        } else if (data.phase === "item") {
          const pct = data.total ? Math.round(((data.current - 1) / data.total) * 100) : 0;
          aiSuggestRulesProgressBar.style.width = pct + "%";
          appendAiSuggestRulesLog(`🔍 [${data.current}/${data.total}] ${data.message}`);
        } else if (data.phase === "item-error") {
          appendAiSuggestRulesLog(`⚠️ ${data.message}`);
        } else if (data.phase === "done") {
          aiSuggestRulesProgressBar.style.width = "100%";
          appendAiSuggestRulesLog(`\n✅ ${data.message}`);
          config.ai.scoring.rules = Array.isArray(data.rules) ? data.rules : [];
          renderRules();
          aiSuggestRulesStatus.textContent = `${data.message}. Rules applied below — Save Config to persist.`;
          aiSuggestRulesStatus.className = "status-msg success";
        } else if (data.phase === "error") {
          appendAiSuggestRulesLog(`\n❌ ${data.message}`);
          aiSuggestRulesStatus.textContent = `Error: ${data.message}`;
          aiSuggestRulesStatus.className = "status-msg error";
        }
      }
    }
  } catch (err) {
    appendAiSuggestRulesLog(`\n❌ ${err.message}`);
    aiSuggestRulesStatus.textContent = `Error: ${err.message}`;
    aiSuggestRulesStatus.className = "status-msg error";
  } finally {
    aiSuggestRulesInFlight = false;
    aiSuggestRulesCancel.disabled = false;
    aiSuggestRulesCancel.textContent = "Close";
    aiSuggestRulesCount.disabled = false;
    aiSuggestRulesRuleCount.disabled = false;
    aiSuggestRulesRun.disabled = false;
  }
});

// --- Headless toggle sync ---
document.getElementById("cfg-headless").addEventListener("change", () => {
  collectForm();
});

// --- AI rating toggle sync ---
cfgAiEnabled.addEventListener("change", () => {
  collectForm();
  renderAiFields();
});
cfgAiProvider.addEventListener("change", () => {
  collectForm();
  renderAiFields();
});

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

