import * as fs from "node:fs";
import * as path from "node:path";
import type { CrawlProgress, DownloadedItem } from "../core/types.js";
import type { AppContext } from "../core/server/context.js";
import type { SseEmitter } from "../core/server/http.js";
import { launchChromium } from "../core/browser.js";
import { fetchTopicDetails, searchPornolab } from "../search/scraper.js";
import { downloadAndCacheImage } from "../core/images/downloader.js";
import { filenameToSearchQuery, findVideoFiles, prepareImagesDirectory } from "./scanner.js";

function captchaProgress(emit: SseEmitter): (progress: CrawlProgress) => void {
  return (progress) => {
    if (progress.phase === "captchaNeeded") emit(progress);
  };
}

async function discoverTopic(
  app: AppContext,
  filePath: string,
  imagesDir: string,
  emit: SseEmitter,
): Promise<Omit<DownloadedItem, "id" | "createdAt">> {
  const fileName = path.basename(filePath);
  const result = await searchPornolab(
    app.loadConfig(),
    { query: filenameToSearchQuery(fileName) },
    captchaProgress(emit),
  );
  const best = result.results[0];
  const empty = {
    fileName,
    filePath,
    title: null,
    topicUrl: null,
    postImage: null,
    cachedImage: null,
    starring: null,
    productionDate: null,
    duration: null,
    size: null,
  };
  if (!best) return empty;

  // Crawl the full topic page for details (cast, date, duration, size) and image.
  let details: Awaited<ReturnType<typeof fetchTopicDetails>> | null = null;
  try {
    details = await fetchTopicDetails(best.topicUrl, app.loadConfig(), emit);
  } catch (err) {
    console.error(`discoverTopic: failed to fetch details for ${best.topicUrl}:`, (err as Error).message);
  }

  const postImage = details?.postImage ?? best.postImage ?? null;
  const cachedImage = postImage
    ? await downloadAndCacheImage(postImage, best.topicUrl, imagesDir)
    : null;

  // Size sometimes appears in tracker results; prefer the detail-page value.
  const size = details?.size ?? best.size ?? null;

  return {
    fileName,
    filePath,
    title: best.title,
    topicUrl: best.topicUrl,
    postImage,
    cachedImage,
    starring: details?.starring ?? null,
    productionDate: details?.productionDate ?? null,
    duration: details?.duration ?? null,
    size,
  };
}

export async function scanDownloadedFolder(
  app: AppContext,
  folderPath: string,
  clean: boolean,
  emit: SseEmitter,
): Promise<void> {
  const store = app.getDownloadedStore();
  if (clean) {
    store.clearAll();
    emit({ phase: "purge", message: "Purged old downloaded data" });
  }

  const imagesDir = prepareImagesDirectory(folderPath, clean);
  if (clean) emit({ phase: "imagesFolder", message: "Created .images folder" });

  const allFiles = findVideoFiles(folderPath);
  const files = clean ? allFiles : allFiles.filter((filePath) => !store.exists(filePath));
  emit({ phase: "scan", message: `Found ${files.length} ${clean ? "video" : "new video"} file(s)` });

  if (files.length === 0) {
    emit({ phase: "done", message: clean ? "Scan complete — 0 video file(s) processed" : "No new files found", items: store.getAll() });
    return;
  }

  for (let index = 0; index < files.length; index++) {
    const filePath = files[index]!;
    const fileName = path.basename(filePath);
    emit({ phase: "processing", message: `Searching for "${fileName}"...`, current: index + 1, total: files.length });

    let item: Omit<DownloadedItem, "id" | "createdAt">;
    try {
      item = await discoverTopic(app, filePath, imagesDir, emit);
    } catch (error) {
      console.error(`Error processing ${fileName}:`, error);
      item = {
        fileName,
        filePath,
        title: null,
        topicUrl: null,
        postImage: null,
        cachedImage: null,
        starring: null,
        productionDate: null,
        duration: null,
        size: null,
      };
    }
    store.insert(item);
    emit({
      phase: "itemDone",
      message: item.title ? `Found: ${item.title}` : `No match found for "${fileName}"`,
      current: index + 1,
      total: files.length,
      ...item,
    });
  }

  emit({
    phase: "done",
    message: clean ? `Scan complete — ${files.length} video file(s) processed` : `Refresh complete — ${files.length} new file(s) added`,
    items: store.getAll(),
  });
}

export async function fetchTopicTitle(topicUrl: string): Promise<string | null> {
  const browser = await launchChromium({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(topicUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000);
    const title = await page.locator("h1.maintitle a, h1.topic-title, h1 a").first().textContent().catch(() => null);
    return title?.trim() || null;
  } finally {
    await browser.close();
  }
}

export async function refreshDownloadedItem(
  app: AppContext,
  item: DownloadedItem,
  emit: SseEmitter,
): Promise<void> {
  const store = app.getDownloadedStore();
  const imagesDir = prepareImagesDirectory(path.dirname(item.filePath));

  if (item.topicUrl) {
    const details = await fetchTopicDetails(item.topicUrl, app.loadConfig(), emit);

    // Only override manually-edited detail fields when the crawler actually
    // recognized them. Missing values (null) keep whatever was previously set.
    const update: {
      title: string | null;
      topicUrl: string;
      postImage: string | null;
      cachedImage: string | null;
      starring: string | null;
      productionDate: string | null;
      duration: string | null;
      size: string | null;
    } = {
      title: item.title,
      topicUrl: item.topicUrl,
      postImage: item.postImage,
      cachedImage: item.cachedImage,
      starring: details.starring ?? item.starring,
      productionDate: details.productionDate ?? item.productionDate,
      duration: details.duration ?? item.duration,
      size: details.size ?? item.size,
    };

    // Post image: re-download only when a fresh URL was parsed and it differs
    // from what we already have cached.
    if (details.postImage && details.postImage !== item.postImage) {
      update.postImage = details.postImage;
      const refreshed = await downloadAndCacheImage(details.postImage, item.topicUrl, imagesDir);
      if (refreshed) update.cachedImage = refreshed;
    }

    store.updateItem(item.id, update);
    emit({
      phase: "done",
      message: "Details refreshed",
      postImage: update.postImage,
      cachedImage: update.cachedImage,
      starring: update.starring,
      productionDate: update.productionDate,
      duration: update.duration,
      size: update.size,
    });
    return;
  }

  const discovered = await discoverTopic(app, item.filePath, imagesDir, emit);
  if (!discovered.topicUrl) {
    emit({ phase: "done", message: "No match found on pornolab" });
    return;
  }
  store.updateTopicInfo(
    item.id,
    discovered.title,
    discovered.topicUrl,
    discovered.postImage,
    discovered.cachedImage,
    discovered.starring,
    discovered.productionDate,
    discovered.duration,
    discovered.size,
  );
  emit({ phase: "done", message: `Found: ${discovered.title}`, ...discovered });
}
