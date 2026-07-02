import { contextBridge } from "electron";

// Expose a minimal API to the renderer process.
// The renderer already uses fetch() to talk to the local server,
// so we only need to expose app version info here.

contextBridge.exposeInMainWorld("electronAPI", {
  getVersion: () => process.env.npm_package_version ?? "1.0.0",
  isElectron: true,
});