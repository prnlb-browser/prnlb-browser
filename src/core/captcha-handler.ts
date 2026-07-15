import type { Page } from "playwright-core";
import { randomUUID } from "node:crypto";
import type { CaptchaInfo } from "./types.js";

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Pending captcha challenges ---

interface PendingCaptcha {
  info: CaptchaInfo;
  resolve: (code: string) => void;
}

const pendingCaptchas = new Map<string, PendingCaptcha>();

export function submitCaptchaCode(captchaId: string, code: string): boolean {
  const pending = pendingCaptchas.get(captchaId);
  if (!pending) return false;
  pending.resolve(code);
  pendingCaptchas.delete(captchaId);
  return true;
}

// --- Detect and handle captcha on login page ---

/**
 * After a login form submission, checks if a captcha page appeared.
 * If so, takes a screenshot of the captcha image element,
 * sends it to the frontend as base64, waits for the user to
 * submit the code, then fills it in and submits.
 *
 * Returns true if captcha was handled (or not needed), false on failure.
 */
export async function handleCaptchaIfPresent(
  page: Page,
  onCaptcha: (info: CaptchaInfo) => void,
): Promise<boolean> {
  // Check for captcha image on the current page
  const captchaImg = page.locator('img[src*="captcha"]');
  if ((await captchaImg.count()) === 0) {
    return true; // No captcha, all good
  }

  // Take a screenshot of the captcha image element — this avoids
  // cookie/session issues with the external image URL
  const screenshotBuf = await captchaImg.first().screenshot();
  const imageBase64 = `data:image/png;base64,${screenshotBuf.toString("base64")}`;

  const captchaId = randomUUID();

  // Notify frontend
  onCaptcha({ imageBase64, captchaId });

  // Wait for user to submit code (up to 5 minutes)
  const code = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCaptchas.delete(captchaId);
      reject(new Error("Captcha code not entered within 5 minutes — timed out"));
    }, 5 * 60 * 1000);

    pendingCaptchas.set(captchaId, {
      info: { imageBase64, captchaId },
      resolve: (c) => {
        clearTimeout(timeout);
        resolve(c);
      },
    });
  });

  // Find the captcha code input and fill it
  // Common captcha input names on pornolab: cap_code, confirm_code
  const codeInput = page.locator(
    'input[name="cap_code"], input[name="confirm_code"], input[name="code"], input[name="captcha_code"]',
  );
  if ((await codeInput.count()) === 0) {
    // Try a more generic approach — any text input that's not username/password
    const genericInput = page.locator(
      'form[action="login.php"] input[type="text"]:not([name="login_username"])',
    );
    if ((await genericInput.count()) > 0) {
      await genericInput.first().fill(code);
    } else {
      console.error("Could not find captcha code input field");
      return false;
    }
  } else {
    await codeInput.first().fill(code);
  }

  // Submit the form and wait for navigation
  const submitBtn = page.locator(
    'form[action="login.php"] input[type="submit"], form[action="login.php"] button[type="submit"]',
  );
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}),
    (async () => {
      if ((await submitBtn.count()) > 0) {
        await submitBtn.first().click();
      } else {
        await page.keyboard.press("Enter");
      }
    })(),
  ]);

  await sleep(2000);
  return true;
}
