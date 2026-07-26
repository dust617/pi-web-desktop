/**
 * Preload bridge – minimal, no attachment panel UI.
 * contextIsolation: ON | nodeIntegration: OFF | sandbox: ON
 *
 * Drag-drop: intercepts drop events, gets real paths via webUtils.getPathForFile,
 * inserts into textarea with deduplication. No floating panel.
 */
import { contextBridge, clipboard, ipcRenderer, webUtils } from "electron";

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

  /** Write text to system clipboard (works even when navigator.clipboard is unavailable) */
  writeClipboard: (text: string): void => {
    clipboard.writeText(text);
  },

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

// ─── Paste focus recovery ────────────────────────────────────────────
// pi-web's image paste handler reads e.clipboardData.items on the *main*
// textarea's onPaste. While the agent is streaming, the user typically
// scrolls / clicks the message area (or a streaming re-render moves
// document.activeElement off the input), so Ctrl+V dispatches the paste
// event to <body> where no handler exists -> clipboardData.items is never
// read and the image is *silently dropped* (the handler returns early when
// there is no image item, with no error). The textarea is NOT disabled
// during runs (pi-web allows "steer / queue follow-up"), so we can simply
// steal focus back to it. Running this in the CAPTURE phase of keydown
// guarantees focus is set before the browser synthesizes the paste event,
// so the paste then lands on the textarea and its onPaste fires.
function findMainTextarea(): HTMLTextAreaElement | null {
  const tas = document.querySelectorAll("textarea");
  for (const el of Array.from(tas)) {
    const ta = el as HTMLTextAreaElement;
    if (ta.disabled) continue;
    // Skip pi-web's hidden 1x1 bracketed-paste textarea (position:absolute,
    // opacity:0, pointerEvents:none) – it is not the visible composer.
    const rect = ta.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const cs = getComputedStyle(ta);
    if (cs.opacity === "0" || cs.pointerEvents === "none" || cs.visibility === "hidden") continue;
    return ta;
  }
  return null;
}

function ensureEditableFocusForPaste(): void {
  const ae = document.activeElement as HTMLElement | null;
  const isEditable =
    ae instanceof HTMLTextAreaElement ||
    ae instanceof HTMLInputElement ||
    (ae?.isContentEditable ?? false);
  if (isEditable) return; // focus already on an editable element -> browser handles paste
  const ta = findMainTextarea();
  if (ta) ta.focus();
}

function init(): void {
  // Suppress Chromium's native drag-over overlay (the translucent blue /
  // "copy" badge that covers the whole window when dragging a file). Without
  // preventDefault on dragover the browser paints its built-in drop-target
  // visual on top of the pi-web UI; the pi-web frontend has its own drop-zone
  // highlight so the native one is redundant and visually broken (transparent
  // image ghost). We only suppress it when files are being dragged so normal
  // in-page drag (e.g. text selection) is untouched.
  const suppressNativeDragOverlay = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
    }
  };
  document.addEventListener("dragover", suppressNativeDragOverlay, { capture: true });
  document.addEventListener("dragenter", suppressNativeDragOverlay, { capture: true });

  document.addEventListener(
    "drop",
    (e) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) {
        // Prevent the browser's default file-drop action (navigate to image /
        // open file) which would replace the pi-web UI entirely.
        e.preventDefault();
        // stopImmediatePropagation prevents the useDragDrop patch from also
        // inserting paths, avoiding duplicates
        e.stopImmediatePropagation();
        handleDrop(files);
      }
    },
    { capture: true }
  );

  // Capture-phase keydown: recover focus to the composer before the paste
  // event is dispatched. We do NOT preventDefault / stopPropagation, so the
  // normal paste flow (and pi-web's own onPaste) continues untouched.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.defaultPrevented) return;
      const k = e.key;
      const isPaste =
        ((e.ctrlKey || e.metaKey) && (k === "v" || k === "V")) ||
        (e.shiftKey && (k === "Insert" || k === "insert"));
      if (isPaste) ensureEditableFocusForPaste();
    },
    { capture: true }
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
