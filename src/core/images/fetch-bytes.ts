import { downloadImageViaBrowser } from "./browser-download.js";
import { isImageBytes } from "./validation.js";

// Fetches resolved image-host URLs with a browser fallback for hosts that
// reject plain HTTP clients.
export async function fetchImageBytes(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url);
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      return isImageBytes(bytes) ? bytes : null;
    }
    if (response.status === 403) {
      const bytes = await downloadImageViaBrowser(url);
      return bytes && isImageBytes(bytes) ? bytes : null;
    }
  } catch {
    // Fall through to null below.
  }
  return null;
}
