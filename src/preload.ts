/**
 * Preload bridge – minimal, no attachment panel UI.
 * contextIsolation: ON | nodeIntegration: OFF | sandbox: ON
 *
 * Drag-drop: intercepts drop events, gets real paths via webUtils.getPathForFile,
 * inserts into textarea with deduplication. No floating panel.
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";

// ─── Exposed API ─────────────────────────────────────────────────────

const api = {
  getRuntimeInfo: () => ipcRenderer.invoke("get-runtime-info"),
  selectFiles: (options?: { directories?: boolean }) =>
    ipcRenderer.invoke("select-files", options),
  showInExplorer: (filePath: string) =>
    ipcRenderer.invoke("show-in-explorer", filePath),
  getVersion: () => ipcRenderer.invoke("get-version"),
  checkFileExists: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke("check-file-exists", filePath),

  /** Get real absolute paths for dragged files (used by useDragDrop patch) */
  getDroppedFilePaths: (files: File[]): string[] => {
    if (!Array.isArray(files)) return [];
    return files
      .map((f) => { try { return webUtils.getPathForFile(f); } catch { return ""; } })
      .filter((p): p is string => p.length > 0);
  },
};

contextBridge.exposeInMainWorld("piDesktop", api);
// useDragDrop.ts patch checks window.__piDesktop
contextBridge.exposeInMainWorld("__piDesktop", api);

// ─── Drop handler: insert paths into textarea with deduplication ─────

function handleDrop(files: File[]): void {
  const paths = files
    .map((f) => { try { return webUtils.getPathForFile(f); } catch { return ""; } })
    .filter((p): p is string => p.length > 0);
  if (!paths.length) return;

  const ta = document.querySelector("textarea") as HTMLTextAreaElement | null;
  if (!ta) return;

  const existing = ta.value;
  const newPaths = paths.filter((p) => !existing.includes(p));
  if (!newPaths.length) return;

  const msg = newPaths.map((p) => `[外部附件 - 文件] ${p}`).join("\n");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (setter) {
    setter.call(ta, existing + (existing ? "\n" : "") + msg);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
  }
}

function init(): void {
  document.addEventListener(
    "drop",
    (e) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) {
        // stopImmediatePropagation prevents the useDragDrop patch from also
        // inserting paths, avoiding duplicates
        e.stopImmediatePropagation();
        handleDrop(files);
      }
    },
    { capture: true }
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
