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

function renderRules() {
  rulesList.innerHTML = "";
  if (!config) return;
  config.ai.scoring.rules.forEach((rule, i) => {
    const div = document.createElement("div");
    div.className = "rule-entry";
    const valueField =
      rule.type === "tag"
        ? `<input type="text" data-field="value" placeholder="e.g. anal" value="${esc(rule.value)}" />`
        : `<select data-field="value">${PERFORMER_CHARACTERISTIC_OPTIONS.map(
            (group) =>
              `<optgroup label="${esc(group.label)}">${group.values
                .map((v) => `<option value="${esc(v)}"${v === rule.value ? " selected" : ""}>${esc(v)}</option>`)
                .join("")}</optgroup>`,
          ).join("")}</select>`;
    div.innerHTML = `
      <select data-field="type">
        <option value="tag"${rule.type === "tag" ? " selected" : ""}>Tag contains</option>
        <option value="performer-characteristic"${rule.type === "performer-characteristic" ? " selected" : ""}>Performer characteristic</option>
      </select>
      <span data-value-slot></span>
      <input type="number" data-field="weight" min="-1" max="1" step="0.1" value="${rule.weight}" />
      <button class="btn btn-small" data-remove="${i}">✕</button>
    `;
    div.querySelector("[data-value-slot]").outerHTML = valueField;
    div.querySelector(`[data-field="type"]`).addEventListener("change", (e) => {
      const newType = e.target.value;
      config.ai.scoring.rules[i] = {
        type: newType,
        value: newType === "tag" ? "" : PERFORMER_CHARACTERISTIC_OPTIONS[0].values[0],
        weight: rule.weight,
      };
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

