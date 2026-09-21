import type { ImageHostResolver, ImageProgress, ResolvedImage, ScrapedImage } from "./types.js";
import { FastpicResolver } from "./fastpic.js";
import { ImgboxResolver } from "./imgbox.js";
import { TurboImageHostResolver } from "./turboimagehost.js";
import { PicshickResolver } from "./picshick.js";

/**
 * Registry of all available image host resolvers.
 * Add new resolvers here to extend image host support.
 */
class ResolverRegistry {
  private resolvers: ImageHostResolver[] = [];

  constructor() {
    // Register built-in resolvers
    this.register(new FastpicResolver());
    this.register(new ImgboxResolver());
    this.register(new TurboImageHostResolver());
    this.register(new PicshickResolver());
  }

  /**
   * Register a new resolver (for extensibility).
   */
  register(resolver: ImageHostResolver): void {
    this.resolvers.push(resolver);
  }

  /** Clear the dedicated browser profile used for TurboImageHost resolution. */
  async clearTurboImageHostVerificationData(): Promise<void> {
    const resolver = this.resolvers.find(
      (candidate): candidate is TurboImageHostResolver => candidate instanceof TurboImageHostResolver,
    );
    if (!resolver) throw new Error("TurboImageHost resolver is not registered");
    await resolver.clearVerificationData();
  }

  /**
   * Find the first matching resolver for a given URL.
   */
  findResolver(url: string): ImageHostResolver | null {
    return this.resolvers.find((r) => r.canHandle(url)) ?? null;
  }

  /**
   * Given a list of scraped images, resolve all that are handled by
   * any registered resolver to their full-size versions.
   * Uses resolveUrl for resolution and passes thumbnailUrl through.
   */
  async resolveImages(
    images: ScrapedImage[],
    onProgress?: (p: ImageProgress) => void,
    signal?: AbortSignal,
  ): Promise<ResolvedImage[]> {
    const total = images.length;
    const results: Array<ResolvedImage | undefined> = new Array(total);
    let completed = 0;

    // Resolve strictly one at a time to avoid burst traffic and host blocks.
    // Progress events still make each completed image available immediately.
    for (let index = 0; index < images.length; index += 1) {
      if (signal?.aborted) break;

      const img = images[index]!;
      const resolver = this.findResolver(img.resolveUrl);
      if (!resolver) {
        completed += 1;
        onProgress?.({
          phase: "resolving",
          message: `Skipped ${completed}/${total}`,
          current: completed,
          total,
        });
        continue;
      }

      onProgress?.({
        phase: "resolving",
        message: `Resolving ${index + 1}/${total}...`,
        current: completed,
        total,
      });

      let resolvedUrl: string | null = null;
      try {
        resolvedUrl = await resolver.resolve(img.resolveUrl, signal);
      } catch (error) {
        if (!signal?.aborted) {
          console.warn(`Could not resolve ${img.resolveUrl}:`, (error as Error).message);
        }
      }
      if (signal?.aborted) break;

      completed += 1;
      const resolved = resolvedUrl
        ? {
            originalUrl: img.resolveUrl,
            thumbnailUrl: img.thumbnailUrl,
            resolvedUrl,
            resolver: resolver.name,
          }
        : undefined;
      results[index] = resolved;

      onProgress?.({
        phase: "resolving",
        message: resolved ? `Resolved ${completed}/${total}` : `Skipped ${completed}/${total}`,
        current: completed,
        total,
        image: resolved,
      });
    }

    return results.filter((image): image is ResolvedImage => image !== undefined);
  }

  /**
   * Get all registered resolver names (useful for debugging).
   */
  getResolverNames(): string[] {
    return this.resolvers.map((r) => r.name);
  }
}

// Singleton instance
export const resolverRegistry = new ResolverRegistry();
