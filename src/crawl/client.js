const btnStart = document.getElementById("btn-start");
const progressLog = document.getElementById("progress-log");
const progressBarContainer = document.getElementById("progress-bar-container");
const progressBar = document.getElementById("progress-bar");
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
    } else if (p.phase === "captchaNeeded" && p.captcha) {
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

