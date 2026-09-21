const screenTimeValue = document.getElementById("screen-time-value");
const usageStatsTotal = document.getElementById("usage-stats-total");
const usageChart = document.getElementById("usage-chart");
const usageChartBars = document.getElementById("usage-chart-bars");
const usageChartMax = document.getElementById("usage-chart-max");
const usageChartMid = document.getElementById("usage-chart-mid");
let usageRefreshInFlight = false;

function formatUsageDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
}

function renderUsageStats(stats) {
  if (screenTimeValue) screenTimeValue.textContent = formatUsageDuration(stats.today?.seconds);
  if (usageStatsTotal) usageStatsTotal.textContent = formatUsageDuration(stats.totalSeconds);
  if (!usageChartBars || !Array.isArray(stats.days) || stats.days.length === 0) return;

  const maxSeconds = Math.max(60, ...stats.days.map((day) => Number(day.seconds) || 0));
  if (usageChartMax) usageChartMax.textContent = formatUsageDuration(maxSeconds);
  if (usageChartMid) usageChartMid.textContent = formatUsageDuration(maxSeconds / 2);
  if (usageChart) usageChart.setAttribute("aria-label", t("Daily active screen time for the last 14 days"));

  const rows = stats.days.map((day) => {
    const date = new Date(`${day.date}T12:00:00`);
    const formattedDate = Number.isNaN(date.getTime()) ? day.date : date.toLocaleDateString(getLocale(), { month: "short", day: "numeric" });
    const column = document.createElement("div");
    column.className = "usage-chart-column";
    column.setAttribute("role", "listitem");
    column.setAttribute("aria-label", `${formattedDate}: ${formatUsageDuration(day.seconds)}`);

    const track = document.createElement("div");
    track.className = "usage-bar-track";
    const bar = document.createElement("div");
    bar.className = "usage-bar";
    bar.style.height = `${Math.min(100, Math.max(0, ((Number(day.seconds) || 0) / maxSeconds) * 100))}%`;
    bar.title = `${formattedDate}: ${formatUsageDuration(day.seconds)}`;
    bar.setAttribute("aria-hidden", "true");
    track.appendChild(bar);

    const dateLabel = document.createElement("span");
    dateLabel.className = "usage-chart-date";
    const month = document.createElement("span");
    month.className = "usage-chart-date-month";
    month.textContent = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(getLocale(), { month: "short" });
    const dayNumber = document.createElement("span");
    dayNumber.className = "usage-chart-date-day";
    dayNumber.textContent = Number.isNaN(date.getTime()) ? day.date : date.toLocaleDateString(getLocale(), { day: "numeric" });
    dateLabel.append(month, dayNumber);
    column.append(track, dateLabel);
    return column;
  });
  usageChartBars.replaceChildren(...rows);
}

async function refreshUsageStats() {
  if (usageRefreshInFlight) return;
  usageRefreshInFlight = true;
  try {
    const res = await fetch("/api/usage");
    if (!res.ok) throw new Error("Failed to load screen time");
    renderUsageStats(await res.json());
  } catch (err) {
    console.warn("Screen time unavailable:", err);
  } finally {
    usageRefreshInFlight = false;
  }
}

refreshUsageStats();
window.setInterval(refreshUsageStats, 1000);
