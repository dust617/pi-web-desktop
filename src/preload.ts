/**
 * Minimal preload bridge – exposes only safe native capabilities.
 * contextIsolation is ON; nodeIntegration is OFF.
 */
import { contextBridge, ipcRenderer } from "electron";

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
});
