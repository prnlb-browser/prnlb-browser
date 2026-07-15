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
    const res = await fetch("/api/results/item/hide", {
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
// Captcha DOM refs
const captchaModal = document.getElementById("captcha-modal");
const captchaModalClose = document.getElementById("captcha-close");
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
    if (tab.dataset.tab === "results") { loadForums(); loadAllResultsKnownTags(); loadResults(); }
    if (tab.dataset.tab === "downloaded") { loadAllKnownTags(); }
    if (tab.dataset.tab === "actress") { loadActresses(); }
  });
});

