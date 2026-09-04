import type { ImageHostResolver, ResolvedImage, ScrapedImage } from "./types.js";
import { FastpicResolver } from "./fastpic.js";
import { ImgboxResolver } from "./imgbox.js";
import { TurboImageHostResolver } from "./turboimagehost.js";

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
    onProgress?: (p: { phase: string; message: string; current: number; total: number }) => void,
    signal?: AbortSignal,
  ): Promise<ResolvedImage[]> {
    const results: ResolvedImage[] = [];
    const total = images.length;

    for (let i = 0; i < images.length; i++) {
      if (signal?.aborted) break;

      const img = images[i]!;
      const resolver = this.findResolver(img.resolveUrl);
      if (!resolver) continue;

      if (onProgress) {
        onProgress({ phase: "resolving", message: `Resolving ${i + 1}/${total}...`, current: i + 1, total });
      }

      const resolvedUrl = await resolver.resolve(img.resolveUrl, signal);
      if (signal?.aborted) break;
      if (resolvedUrl) {
        results.push({
          originalUrl: img.resolveUrl,
          thumbnailUrl: img.thumbnailUrl,
          resolvedUrl,
          resolver: resolver.name,
        });
      }
    }

    return results;
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
