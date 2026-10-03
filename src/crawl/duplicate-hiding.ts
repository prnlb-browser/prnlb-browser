import type { TopicData } from "../core/types.js";

export type VideoQuality = "1080p" | "2160p" | "720p";

const QUALITY_PATTERN = /\b(2160p|1080p|720p)\b/gi;
const DURATION_PATTERN = /^(\d+):(\d{1,2}):(\d{1,2})$/;

interface DuplicateCandidate {
  topic: TopicData;
  quality: VideoQuality;
  duration: string;
  durationSeconds: number | null;
}

function getQuality(title: string): VideoQuality | null {
  const match = title.match(QUALITY_PATTERN);
  const value = match?.[0]?.toLowerCase();
  return value === "1080p" || value === "2160p" || value === "720p" ? value : null;
}

function getTitleKey(title: string): string {
  return title
    .replace(QUALITY_PATTERN, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function parseDurationSeconds(duration: string): number | null {
  const match = duration.trim().match(DURATION_PATTERN);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function durationsMatch(first: DuplicateCandidate, second: DuplicateCandidate): boolean {
  if (first.durationSeconds !== null && second.durationSeconds !== null) {
    return Math.abs(first.durationSeconds - second.durationSeconds) <= 1;
  }
  return first.duration === second.duration;
}

export function hideDuplicateQualities(
  topics: TopicData[],
  preferredQuality: VideoQuality,
  onHidden?: (topic: TopicData, quality: VideoQuality) => void,
): TopicData[] {
  const groups = new Map<string, DuplicateCandidate[]>();

  for (const topic of topics) {
    const quality = getQuality(topic.title);
    const duration = topic.duration?.trim();
    if (!quality || !duration) continue;

    const key = getTitleKey(topic.title);
    const group = groups.get(key) ?? [];
    group.push({ topic, quality, duration, durationSeconds: parseDurationSeconds(duration) });
    groups.set(key, group);
  }

  return topics.map((topic) => {
    const quality = getQuality(topic.title);
    const duration = topic.duration?.trim();
    if (!quality || !duration || quality === preferredQuality) return topic;

    const key = getTitleKey(topic.title);
    const group = groups.get(key);
    const candidate: DuplicateCandidate = {
      topic,
      quality,
      duration,
      durationSeconds: parseDurationSeconds(duration),
    };
    const hasDuplicateQuality = group?.some((other) =>
      other.quality !== quality && durationsMatch(candidate, other),
    );
    if (!hasDuplicateQuality) return topic;

    onHidden?.(topic, quality);
    return { ...topic, hidden: 1 };
  });
}
