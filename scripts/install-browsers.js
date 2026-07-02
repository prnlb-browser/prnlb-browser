/**
 * Download Chromium binaries into the local `browsers/` directory.
 *
 * Run manually once, or automatically via the `install-browsers` npm script.
 * The `browsers/` directory is then bundled into the Electron distributable
 * via `extraResources` so end-users never need to install browsers themselves.
 *
 * Usage:
 *   node scripts/install-browsers.js                         # install for current platform
 *   node scripts/install-browsers.js --with-deps              # also install OS dependencies
 *   node scripts/install-browsers.js --platform=win32         # Windows x64 (default arch)
 *   node scripts/install-browsers.js --platform=win32 --arch=arm64   # Windows ARM64
 *   node scripts/install-browsers.js --platform=linux         # Linux x64
 *   node scripts/install-browsers.js --platform=darwin        # macOS arm64 (default arch)
 *   node scripts/install-browsers.js --platform=darwin --arch=x64    # macOS Intel
 */
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const BROWSERS_PATH = path.resolve(__dirname, "..", "browsers");

// Parse flags
const platformArg = process.argv.find((a) => a.startsWith("--platform="));
const targetPlatform = platformArg ? platformArg.split("=")[1] : null;

const archArg = process.argv.find((a) => a.startsWith("--arch="));
const targetArch = archArg ? archArg.split("=")[1] : null;

const extraArgs = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--platform=") && !a.startsWith("--arch="))
  .join(" ");

console.log(
  `⬇️  Installing Chromium into ${BROWSERS_PATH}${targetPlatform ? ` (platform: ${targetPlatform}, arch: ${targetArch || "default"})` : ""} ...`,
);

const playwrightCli = path.resolve(
  __dirname, "..", "node_modules", "playwright-core", "cli.js",
);

if (targetPlatform) {
  // Cross-platform build: write a --require preload script that overrides
  // process.platform and process.arch before playwright-core reads them.
  // Using --require ensures the overrides apply inside the CLI process itself.
  // Default arch per platform (most common targets)
  const defaultArchMap = {
    win32: "x64",
    linux: "x64",
    darwin: "arm64",
  };
  const arch = targetArch || defaultArchMap[targetPlatform] || process.arch;
  const override = { platform: targetPlatform, arch };

  const preloadScript = path.join(__dirname, ".platform-override.cjs");
  const tmpDir = require("os").tmpdir();
  fs.writeFileSync(preloadScript, [
    `const os = require("os");`,
    `Object.defineProperty(process, "platform", { value: ${JSON.stringify(override.platform)} });`,
    `Object.defineProperty(process, "arch", { value: ${JSON.stringify(override.arch)} });`,
    // Override os.tmpdir so playwright can create temp directories for downloading
    `const origTmpdir = os.tmpdir;`,
    `os.tmpdir = () => ${JSON.stringify(tmpDir)};`,
  ].join("\n"));

  execSync(
    `node --require ${JSON.stringify(preloadScript)} ${JSON.stringify(playwrightCli)} install chromium ${extraArgs}`.trim(),
    {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH },
      stdio: "inherit",
    },
  );

  fs.unlinkSync(preloadScript);
} else {
  // Same-platform build: run playwright-core CLI directly
  execSync(
    `node ${JSON.stringify(playwrightCli)} install chromium ${extraArgs}`.trim(),
    {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH },
      stdio: "inherit",
    },
  );
}

console.log("✅ Chromium installed successfully.");
