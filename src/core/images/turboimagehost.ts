import type { BrowserWindow } from "electron";
import { URL } from "node:url";
import type { ImageHostResolver } from "./types.js";

const INITIAL_WAIT_MS = 15_000;
const HUMAN_VERIFICATION_WAIT_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 250;
const SESSION_PARTITION = "persist:turboimagehost";

/**
 * Resolver for TurboImageHost image pages.
 *
 * TurboImageHost populates the actual turboimg.net image URL in the DOM with
 * JavaScript. A hidden Electron BrowserWindow is used for normal resolution;
 * if a human check is encountered, that same window is shown and focused so
 * the user can complete it. A dedicated persistent Electron session keeps
 * cookies and local storage for subsequent images and future app launches.
 */
export class TurboImageHostResolver implements ImageHostResolver {
  name = "turboimagehost";

  private verificationWindow: BrowserWindow | null = null;
  private sessionGeneration = 0;

  canHandle(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (
        (parsed.hostname === "turboimg.net" || parsed.hostname.endsWith(".turboimg.net")) &&
        /^\/sp\/[a-z0-9]+\/[^/]+\.(?:jpe?g|png|gif|webp|bmp)$/i.test(parsed.pathname)
      ) {
        return true;
      }

      return (
        (parsed.hostname === "turboimagehost.com" ||
          parsed.hostname === "www.turboimagehost.com") &&
        /^\/p\/\d+\/[^/]+\.html$/i.test(parsed.pathname)
      );
    } catch {
      return false;
    }
  }

  async resolve(url: string, signal?: AbortSignal): Promise<string | null> {
    if (this.isDirectImageUrl(url)) return this.upgradeToHttps(url);

    const sessionGeneration = this.sessionGeneration;
    let window: BrowserWindow | null = null;
    let keepWindowOpen = false;
    try {
      this.throwIfAborted(signal);
      this.throwIfSessionWasCleared(sessionGeneration);
      window = await this.getVerificationWindow();

      const onAbort = () => {
        if (window && !window.isDestroyed()) window.destroy();
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        await window.loadURL(url);
        this.throwIfSessionWasCleared(sessionGeneration);

        const initialResult = await this.waitForImage(window, INITIAL_WAIT_MS, signal);
        if (initialResult) return initialResult;

        // A missing rendered image is most commonly the TurboImageHost/
        // Cloudflare human check. Show the real Electron window and wait until
        // the user completes it. Closing the screenshot dialog aborts this
        // wait through the request signal.
        console.warn(`TurboImageHost human verification may be required: ${url}`);
        await this.focusVerificationWindow(window);
        const verifiedResult = await this.waitForImage(window, HUMAN_VERIFICATION_WAIT_MS, signal);
        if (verifiedResult) return verifiedResult;

        // Leave the visible Electron window open after the verification wait
        // expires so the user can still finish the check manually.
        keepWindowOpen = true;
        return null;
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    } catch (err) {
      this.throwIfSessionWasCleared(sessionGeneration);
      if (!signal?.aborted) {
        console.error(
          `TurboImageHostResolver: Failed to resolve ${url}:`,
          (err as Error).message,
        );
      }
      return null;
    } finally {
      if (window && !window.isDestroyed()) {
        if (signal?.aborted) {
          // A dismissed carousel should not leave an interactive verification
          // window behind. Electron's default session keeps completed cookies.
          window.destroy();
        } else if (!keepWindowOpen) {
          // Keep the Electron window hidden between images so its session
          // cookie is reused without flashing a new window for every image.
          window.hide();
        }
      }
    }
  }

  /**
   * Removes only the data in this resolver's dedicated Electron session.
   * It also cancels an in-progress page load so an old verification page
   * cannot repopulate the just-cleared session.
   */
  async clearVerificationData(): Promise<void> {
    this.sessionGeneration += 1;

    const window = this.verificationWindow;
    this.verificationWindow = null;
    if (window && !window.isDestroyed()) window.destroy();

    const { session } = await import("electron");
    const verificationSession = session.fromPartition(SESSION_PARTITION);
    await Promise.all([
      verificationSession.clearStorageData(),
      verificationSession.clearCache(),
    ]);
  }

  private async getVerificationWindow(): Promise<BrowserWindow> {
    if (this.verificationWindow && !this.verificationWindow.isDestroyed()) {
      return this.verificationWindow;
    }

    const { BrowserWindow } = await import("electron");
    const window = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      title: "TurboImageHost verification",
      webPreferences: {
        // Keep the human-verification state separate from the app UI and
        // retain it across Electron restarts with a stable session partition.
        partition: SESSION_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    this.verificationWindow = window;
    // TurboImageHost occasionally opens advertising tabs with window.open().
    // The resolver never needs a child window: the rendered image and any
    // legitimate verification UI stay in this Electron window.
    window.webContents.setWindowOpenHandler(({ url }) => {
      console.warn(`TurboImageHostResolver: Blocked popup ${url}`);
      return { action: "deny" };
    });
    window.on("closed", () => {
      if (this.verificationWindow === window) this.verificationWindow = null;
    });
    return window;
  }

  private async focusVerificationWindow(window: BrowserWindow): Promise<void> {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    window.webContents.focus();
  }

  private async waitForImage(
    window: BrowserWindow,
    timeoutMs: number | undefined,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;

    while (!window.isDestroyed() && (deadline === undefined || Date.now() < deadline)) {
      this.throwIfAborted(signal);
      const html = await window.webContents
        .executeJavaScript("document.documentElement?.outerHTML ?? ''", true)
        .catch(() => "");
      const imageUrl = this.extractFullImageUrl(typeof html === "string" ? html : "");
      if (imageUrl) return imageUrl;
      await this.sleep(POLL_INTERVAL_MS, signal);
    }

    return null;
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        cleanup();
        reject(this.abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  /**
   * Extract the full-size URL from the rendered DOM. TurboImageHost URLs look
   * like https://s8d4.turboimg.net/sp/<token>/1.jpg.
   */
  private extractFullImageUrl(html: string): string | null {
    const normalizedHtml = html.replace(/\s+/g, " ");
    const imageUrlPattern =
      "(https?:\\/\\/(?:[a-z0-9-]+\\.)?turboimg\\.net\\/sp\\/[a-z0-9]+\\/[^\\s<>\"']+)";
    const attributeRegex = new RegExp(
      `<img\\b[^>]+(?:src|data-src|data-original)=\\s*[\"']${imageUrlPattern}[\"']`,
      "i",
    );
    const match = normalizedHtml.match(attributeRegex);
    if (match?.[1]) return this.upgradeToHttps(this.decodeHtmlEntities(match[1]));

    const fallbackMatch = normalizedHtml.match(new RegExp(imageUrlPattern, "i"));
    return fallbackMatch?.[1]
      ? this.upgradeToHttps(this.decodeHtmlEntities(fallbackMatch[1]))
      : null;
  }

  private upgradeToHttps(url: string): string {
    return url.replace(/^http:/i, "https:");
  }

  private isDirectImageUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        (parsed.hostname === "turboimg.net" || parsed.hostname.endsWith(".turboimg.net")) &&
        /^\/sp\/[a-z0-9]+\/[^/]+\.(?:jpe?g|png|gif|webp|bmp)$/i.test(parsed.pathname)
      );
    } catch {
      return false;
    }
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw this.abortError();
  }

  private throwIfSessionWasCleared(sessionGeneration: number): void {
    if (this.sessionGeneration !== sessionGeneration) {
      const error = new Error("TurboImageHost verification data was cleared");
      error.name = "AbortError";
      throw error;
    }
  }

  private abortError(): Error {
    const error = new Error("Aborted");
    error.name = "AbortError";
    return error;
  }

  private decodeHtmlEntities(value: string): string {
    return value
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
}
