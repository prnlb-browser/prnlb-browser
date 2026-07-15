/**
 * Interface for image host resolvers.
 * Each resolver knows how to find images from a specific host and resolve
 * thumbnail URLs to full-size image URLs.
 */
export interface ImageHostResolver {
  /** Unique name for this resolver (e.g. "fastpic") */
  name: string;

  /**
   * Check if this resolver can handle the given image URL.
   * Used to filter images found in topic posts.
   */
  canHandle(url: string): boolean;

  /**
   * Resolve a thumbnail/post image URL to its full-size version.
   * Returns the full-size image URL or null if resolution fails.
   */
  resolve(url: string): Promise<string | null>;
}

/**
 * A scraped image from a topic post, with separate URLs
 * for the carousel thumbnail and the resolver.
 */
export interface ScrapedImage {
  /** URL for the carousel thumbnail (typically the <img src>) */
  thumbnailUrl: string;
  /** URL to pass to the resolver (typically the <a href>) */
  resolveUrl: string;
}

/**
 * Result returned by the image resolution endpoint.
 */
export interface ResolvedImage {
  /** The original URL used for resolution (the <a href>) */
  originalUrl: string;
  /** The thumbnail URL for carousel display (the <img src>) */
  thumbnailUrl: string;
  /** The resolved full-size URL */
  resolvedUrl: string;
  /** Which resolver handled this image */
  resolver: string;
}

/** Progress callback for image resolution */
export interface ImageProgress {
  phase: "scraping" | "resolving" | "done" | "error";
  message: string;
  current?: number;
  total?: number;
}