/**
 * Minimal preload bridge – exposes only safe native capabilities.
 * contextIsolation: ON | nodeIntegration: OFF | sandbox: ON
 *
 * Drag-drop: uses webUtils.getPathForFile(file) — the official Electron way
 * to get real filesystem paths from dragged files in the renderer.
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("piDesktop", {
  /** Get runtime info (port, url) */
  getRuntimeInfo: () => ipcRenderer.invoke("get-runtime-info"),

  /** Open a file picker dialog, returns selected paths */
  selectFiles: (options?: { directories?: boolean }) =>
    ipcRenderer.invoke("select-files", options),

  /** Show a file/folder in the system file explorer */
  showInExplorer: (filePath: string) =>
    ipcRenderer.invoke("show-in-explorer", filePath),

  /** App version info */
  getVersion: () => ipcRenderer.invoke("get-version"),

  /**
   * Get real absolute paths for files dragged into the window.
   * Uses webUtils.getPathForFile — the only reliable way in Electron
   * with contextIsolation enabled.
   */
  getDroppedFilePaths: (files: File[]): string[] => {
    if (!Array.isArray(files)) return [];
    return files
      .map((file) => {
        try {
          return webUtils.getPathForFile(file);
        } catch {
          return "";
        }
      })
      .filter((p): p is string => p.length > 0);
  },
});
