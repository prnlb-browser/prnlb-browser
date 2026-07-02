import type { ImageHostResolver, ResolvedImage } from "./types.js";
import { FastpicResolver } from "./fastpic.js";
import { ImgboxResolver } from "./imgbox.js";

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
  }

  /**
   * Register a new resolver (for extensibility).
   */
  register(resolver: ImageHostResolver): void {
    this.resolvers.push(resolver);
  }

  /**
   * Find the first matching resolver for a given URL.
   */
  findResolver(url: string): ImageHostResolver | null {
    return this.resolvers.find((r) => r.canHandle(url)) ?? null;
  }

  /**
   * Given a list of image URLs, resolve all that are handled by
   * any registered resolver to their full-size versions.
   */
  async resolveImages(
    urls: string[],
    onProgress?: (p: { phase: string; message: string; current: number; total: number }) => void,
  ): Promise<ResolvedImage[]> {
    const results: ResolvedImage[] = [];
    const total = urls.length;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]!;
      const resolver = this.findResolver(url);
      if (!resolver) continue;

      if (onProgress) {
        onProgress({ phase: "resolving", message: `Resolving ${i + 1}/${total}...`, current: i + 1, total });
      }

      const resolvedUrl = await resolver.resolve(url);
      if (resolvedUrl) {
        results.push({
          originalUrl: url,
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
