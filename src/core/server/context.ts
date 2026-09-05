import * as path from "node:path";
import type { CrawlProgress, ItemRef, NavigateDestination, TopicData } from "../types.js";
import { ConfigStore } from "../../config/store.js";
import { createTopicStore, type TopicStore } from "../../results/store.js";
import { createDownloadedStore, type DownloadedStore } from "../../downloaded/store.js";
import { createActressStore, type ActressStore } from "../../actresses/store.js";

export interface CrawlState {
  isRunning: boolean;
  lastProgress: CrawlProgress | null;
  lastResults: TopicData[] | null;
  listeners: Set<(progress: CrawlProgress) => void>;
}

export class AppContext {
  readonly configStore: ConfigStore;
  readonly crawl: CrawlState = {
    isRunning: false,
    lastProgress: null,
    lastResults: null,
    listeners: new Set(),
  };

  private currentConfig = null as ReturnType<ConfigStore["load"]> | null;
  private topicStore: TopicStore | null = null;
  private downloadedStore: DownloadedStore | null = null;
  private actressStore: ActressStore | null = null;
  private navigator: ((item: ItemRef, destination: NavigateDestination) => Promise<void>) | null = null;

  constructor(
    readonly staticDir: string,
    readonly userDataDir: string,
  ) {
    this.configStore = new ConfigStore(userDataDir);
  }

  loadConfig(): ReturnType<ConfigStore["load"]> {
    this.currentConfig ??= this.configStore.load();
    return this.currentConfig;
  }

  saveConfig(config: ReturnType<ConfigStore["load"]>): void {
    this.configStore.save(config);
    this.currentConfig = config;
  }

  getTopicStore(): TopicStore {
    if (!this.topicStore) {
      const config = this.loadConfig();
      const dbPath = path.isAbsolute(config.dbPath) ? config.dbPath : path.join(this.userDataDir, config.dbPath);
      this.topicStore = createTopicStore(dbPath);
    }
    return this.topicStore;
  }

  getDownloadedStore(): DownloadedStore {
    if (!this.downloadedStore) {
      const config = this.loadConfig();
      const dbPath = path.isAbsolute(config.dbPath) ? config.dbPath : path.join(this.userDataDir, config.dbPath);
      this.downloadedStore = createDownloadedStore(dbPath);
    }
    return this.downloadedStore;
  }

  getActressStore(): ActressStore {
    if (!this.actressStore) {
      const config = this.loadConfig();
      const dbPath = path.isAbsolute(config.dbPath) ? config.dbPath : path.join(this.userDataDir, config.dbPath);
      this.actressStore = createActressStore(dbPath);
    }
    return this.actressStore;
  }

  emitCrawlProgress(progress: CrawlProgress): void {
    this.crawl.lastProgress = progress;
    for (const listener of this.crawl.listeners) listener(progress);
  }

  setNavigator(navigator: (item: ItemRef, destination: NavigateDestination) => Promise<void>): void {
    this.navigator = navigator;
  }

  async navigateToItem(item: ItemRef, destination: NavigateDestination): Promise<void> {
    if (!this.navigator) throw new Error("Electron navigation is not available");
    await this.navigator(item, destination);
  }
}
