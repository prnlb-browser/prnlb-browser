// Set Playwright browser path BEFORE importing anything that uses playwright.
// In packaged Electron apps, browsers are in extraResources/browsers/.
// In development, browsers are in the project root's browsers/ folder.
import * as path from "node:path";
const bundledBrowsersDir = path.join(
  process.resourcesPath || path.join(__dirname, "../.."),
  "browsers",
);
process.env.PLAYWRIGHT_BROWSERS_PATH = bundledBrowsersDir;

import { app, BrowserWindow, Menu, dialog } from "electron";
import * as fs from "node:fs";
import { startServer } from "./server.js";

let mainWindow: BrowserWindow | null = null;

function getPublicDir(): string {
  if (app.isPackaged) {
    // In production (packaged asar), public/ lives in the Resources folder
    return path.join(process.resourcesPath, "public");
  }
  // In development, public/ is at the project root
  return path.join(__dirname, "../../public");
}

function getBundledConfigPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "config.json");
  }
  return path.join(__dirname, "../../config.json");
}

async function createWindow(port: number): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "prnlb-browser",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Build application menu
  const menu = Menu.buildFromTemplate([
    {
      label: "prnlb-browser",
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Toggle DevTools",
          accelerator: "CmdOrCtrl+Shift+I",
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  // Load the app from the local server
  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    // Set the static dir for the server to our resolved public path
    const publicDir = getPublicDir();

    // Use Electron's userData directory so data persists and is writable
    const userDataDir = app.getPath("userData");

    // Copy bundled config.json to userDataDir on first run (if not already present)
    const userConfigPath = path.join(userDataDir, "config.json");
    if (!fs.existsSync(userConfigPath)) {
      const bundledConfigPath = getBundledConfigPath();
      if (fs.existsSync(bundledConfigPath)) {
        fs.copyFileSync(bundledConfigPath, userConfigPath);
        console.log("✅ Default config copied to", userConfigPath);
      } else {
        console.log("⚠️  No bundled config.json found at", bundledConfigPath);
      }
    }

    const { port } = await startServer({ staticDir: publicDir, userDataDir, port: 0 });
    console.log(`✅ Electron server started on random port ${port}`);
    await createWindow(port);
  } catch (err) {
    console.error("Failed to start:", err);
    dialog.showErrorBox("Startup Error", String(err));
    app.quit();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (mainWindow === null && app.isReady()) {
    // Window will be recreated by whenReady logic — fine to skip here
  }
});