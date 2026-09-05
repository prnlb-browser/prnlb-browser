import { downloadImageViaBrowser } from "./browser-download.js";

// Fetches resolved image-host URLs with a browser fallback for hosts that
// reject plain HTTP clients.
export async function fetchImageBytes(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url);
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    if (response.status === 403) return await downloadImageViaBrowser(url);
  } catch {
    // Fall through to null below.
  }
  return null;
}
