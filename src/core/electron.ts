// Set Playwright browser path BEFORE importing anything that uses playwright.
// playwright-core reads PLAYWRIGHT_BROWSERS_PATH once, at module load time
// (not per-launch), so this must be set correctly before "./server/index.js"
// (which transitively requires playwright-core) is required below.
// app.isPackaged and process.resourcesPath are both available immediately
// after requiring "electron" — no need to wait for app.whenReady().
import * as path from "node:path";
import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from "electron";

process.env.PLAYWRIGHT_BROWSERS_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "browsers")
  : path.join(__dirname, "../../../browsers");

import * as fs from "node:fs";
import { startServer } from "./server/index.js";

let mainWindow: BrowserWindow | null = null;

function getPublicDir(): string {
  if (app.isPackaged) {
    // In production (packaged asar), public/ lives in the Resources folder
    return path.join(process.resourcesPath, "public");
  }
  // In development, public/ is at the project root
  return path.join(__dirname, "../../../public");
}

function getBundledConfigPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "config.template.json");
  }
  return path.join(__dirname, "../../../config.template.json");
}

function setupIpcHandlers(): void {
  // Open folder picker and return selected path
  ipcMain.handle("dialog:selectFolder", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Show file in Finder/Explorer
  ipcMain.handle("shell:showItemInFolder", (_event, filePath: string) => {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
    }
  });

  // Open file with OS default player
  ipcMain.handle("shell:openPath", async (_event, filePath: string) => {
    if (filePath && fs.existsSync(filePath)) {
      return await shell.openPath(filePath);
    }
    return "File not found";
  });

  // Real app version (read from package.json by Electron). Exposed to the
  // renderer because `process.env.npm_package_version` is only set when
  // launched via npm/yarn, not in a packaged app.
  ipcMain.handle("app:getVersion", () => app.getVersion());
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
    setupIpcHandlers();

    // Set the static dir for the server to our resolved public path
    const publicDir = getPublicDir();

    // Use Electron's userData directory so data persists and is writable
    const userDataDir = app.getPath("userData");

    // Merge bundled config.template.json into userDataDir copy on every startup
    // so new fields (e.g. downloadedFolder) are picked up while preserving user settings.
    // The bundled template is credentials-free; any credentials the user enters
    // through the UI are written only to userConfigPath inside userDataDir.
    const userConfigPath = path.join(userDataDir, "config.json");
    const bundledConfigPath = getBundledConfigPath();
    if (fs.existsSync(bundledConfigPath)) {
      const bundledConfig = JSON.parse(fs.readFileSync(bundledConfigPath, "utf-8"));
      let userConfig: Record<string, unknown> = {};
      if (fs.existsSync(userConfigPath)) {
        try {
          userConfig = JSON.parse(fs.readFileSync(userConfigPath, "utf-8"));
        } catch {
          console.log("⚠️  Corrupt user config, overwriting with bundled template");
        }
      }
      // Merge: bundled values are defaults, user values take precedence.
      // For `credentials`, if the bundled template has empty values, prefer
      // whatever the user already has saved (otherwise an updated template
      // would wipe stored credentials on every launch).
      const merged: Record<string, unknown> = { ...bundledConfig, ...userConfig };
      const bundledCreds = (bundledConfig.credentials as { username?: string; password?: string } | undefined) ?? {};
      if (
        (bundledCreds.username ?? "") === "" &&
        (bundledCreds.password ?? "") === "" &&
        userConfig.credentials
      ) {
        merged.credentials = userConfig.credentials;
      }
      fs.writeFileSync(userConfigPath, JSON.stringify(merged, null, 2), "utf-8");
      console.log("✅ Config merged and written to", userConfigPath);
    } else {
      console.log("⚠️  No bundled config.template.json found at", bundledConfigPath);
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