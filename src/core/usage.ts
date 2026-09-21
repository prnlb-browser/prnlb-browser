import * as fs from "node:fs";
import * as path from "node:path";

export interface UsageDay {
  date: string;
  seconds: number;
}

export interface UsageStats {
  active: boolean;
  today: UsageDay;
  totalSeconds: number;
  days: UsageDay[];
}

interface UsageFile {
  days?: Record<string, number>;
}

function dateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(timestamp: number, days: number): number {
  const date = new Date(timestamp);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function startOfNextDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

function addInterval(days: Record<string, number>, start: number, end: number): void {
  if (end <= start) return;

  let cursor = start;
  while (cursor < end) {
    const nextDay = startOfNextDay(cursor);
    const segmentEnd = Math.min(end, nextDay);
    const key = dateKey(cursor);
    days[key] = (days[key] ?? 0) + (segmentEnd - cursor) / 1000;
    cursor = segmentEnd;
  }
}

export class UsageStore {
  private readonly usagePath: string;
  private readonly days: Record<string, number>;
  private activeSince: number | null = null;
  private active = false;
  private readonly now: () => number;
  private readonly flushTimer: NodeJS.Timeout;

  constructor(userDataDir: string, now: () => number = () => Date.now()) {
    this.usagePath = path.join(userDataDir, "screen-time.json");
    this.now = now;
    this.days = this.load();
    // Persist an active session periodically so a process crash loses at most
    // a short interval of usage rather than the entire current session.
    this.flushTimer = setInterval(() => this.flush(), 10_000);
    this.flushTimer.unref();
  }

  setActive(active: boolean, at: number = this.now()): void {
    if (active === this.active) return;
    if (this.activeSince !== null) addInterval(this.days, this.activeSince, at);
    this.active = active;
    this.activeSince = active ? at : null;
    this.persist();
  }

  getStats(at: number = this.now()): UsageStats {
    const snapshot = { ...this.days };
    if (this.activeSince !== null) addInterval(snapshot, this.activeSince, at);

    const todayKey = dateKey(at);
    const days: UsageDay[] = [];
    for (let offset = 13; offset >= 0; offset -= 1) {
      const timestamp = addDays(at, -offset);
      const date = dateKey(timestamp);
      days.push({ date, seconds: Math.round(snapshot[date] ?? 0) });
    }

    return {
      active: this.active,
      today: { date: todayKey, seconds: Math.round(snapshot[todayKey] ?? 0) },
      totalSeconds: days.reduce((total, day) => total + day.seconds, 0),
      days,
    };
  }

  flush(at: number = this.now()): void {
    if (this.activeSince === null) return;
    addInterval(this.days, this.activeSince, at);
    this.activeSince = at;
    this.persist();
  }

  close(): void {
    clearInterval(this.flushTimer);
    this.flush();
  }

  private load(): Record<string, number> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.usagePath, "utf-8")) as UsageFile;
      if (!parsed.days || typeof parsed.days !== "object") return {};
      return Object.fromEntries(
        Object.entries(parsed.days).filter(([, seconds]) => typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0),
      );
    } catch {
      return {};
    }
  }

  private persist(): void {
    fs.writeFileSync(this.usagePath, JSON.stringify({ days: this.days }, null, 2), "utf-8");
  }
}
