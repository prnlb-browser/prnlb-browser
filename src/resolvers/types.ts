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
 * Result returned by the image resolution endpoint.
 */
export interface ResolvedImage {
  /** The original URL found in the post */
  originalUrl: string;
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