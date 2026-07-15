import { contextBridge, ipcRenderer } from "electron";

// Expose a minimal API to the renderer process.
// The renderer already uses fetch() to talk to the local server,
// so we only need to expose app version info here + IPC for native dialogs.

contextBridge.exposeInMainWorld("electronAPI", {
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  isElectron: true,
  selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),
  showItemInFolder: (filePath: string) => ipcRenderer.invoke("shell:showItemInFolder", filePath),
  openPath: (filePath: string) => ipcRenderer.invoke("shell:openPath", filePath),
});