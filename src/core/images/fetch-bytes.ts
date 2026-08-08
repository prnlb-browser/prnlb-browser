import { downloadImageViaBrowser } from "./browser-download.js";

// Shared by the AI screenshot analyzer and the topic-image preview proxy —
// both fetch bytes from the same resolved image-host URLs and need the same
// Cloudflare-403 fallback (some hosts block plain HTTP clients but serve the
// same image fine to a real browser).
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
