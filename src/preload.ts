/**
 * Preload bridge + External Attachment Panel
 * contextIsolation: ON | nodeIntegration: OFF | sandbox: ON
 *
 * Injects a floating attachment panel into the pi-web page.
 * Files dragged into the window are captured via webUtils.getPathForFile
 * and shown in the panel with remove / show-in-explorer / exists-check.
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";

// ─── Exposed API ─────────────────────────────────────────────────────

contextBridge.exposeInMainWorld("piDesktop", {
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
});

// ─── Attachment Panel (injected into page DOM) ───────────────────────

interface Attachment {
  path: string;
  name: string;
  exists: boolean;
}

let attachments: Attachment[] = [];
let panelEl: HTMLElement | null = null;

function basename(p: string): string {
  return p.replace(/\\/g, "/").split("/").pop() ?? p;
}

function buildPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.id = "__pi-desktop-attachments";
  Object.assign(panel.style, {
    position: "fixed",
    bottom: "80px",
    right: "16px",
    width: "280px",
    maxHeight: "220px",
    overflowY: "auto",
    background: "var(--color-bg-secondary, #1e1e2e)",
    border: "1px solid var(--color-border, #444)",
    borderRadius: "8px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
    zIndex: "99999",
    fontFamily: "system-ui, sans-serif",
    fontSize: "12px",
    display: "none",
    flexDirection: "column",
  } as CSSStyleDeclaration);

  const header = document.createElement("div");
  Object.assign(header.style, {
    padding: "6px 10px",
    fontWeight: "bold",
    borderBottom: "1px solid var(--color-border, #444)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    color: "var(--color-text, #ccc)",
  } as CSSStyleDeclaration);
  header.innerHTML = `<span>📎 外部附件</span>`;

  const clearBtn = document.createElement("button");
  clearBtn.textContent = "清空";
  Object.assign(clearBtn.style, {
    background: "none", border: "none", cursor: "pointer",
    color: "var(--color-text-muted, #888)", fontSize: "11px",
  } as CSSStyleDeclaration);
  clearBtn.onclick = () => { attachments = []; renderList(); };
  header.appendChild(clearBtn);

  const list = document.createElement("div");
  list.id = "__pi-attach-list";
  Object.assign(list.style, { padding: "4px 0" } as CSSStyleDeclaration);

  panel.appendChild(header);
  panel.appendChild(list);
  return panel;
}

function renderList(): void {
  if (!panelEl) return;
  const list = panelEl.querySelector("#__pi-attach-list") as HTMLElement;
  if (!list) return;

  panelEl.style.display = attachments.length > 0 ? "flex" : "none";
  list.innerHTML = "";

  for (const att of attachments) {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex", alignItems: "center", gap: "4px",
      padding: "4px 10px", cursor: "default",
      color: att.exists ? "var(--color-text, #ccc)" : "#e05555",
    } as CSSStyleDeclaration);
    row.title = att.path;

    const icon = document.createElement("span");
    icon.textContent = att.exists ? "📄" : "⚠️";

    const name = document.createElement("span");
    name.textContent = att.name;
    Object.assign(name.style, {
      flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    } as CSSStyleDeclaration);

    const explorerBtn = document.createElement("button");
    explorerBtn.textContent = "📁";
    explorerBtn.title = "在资源管理器中显示";
    Object.assign(explorerBtn.style, { background: "none", border: "none", cursor: "pointer", fontSize: "12px" } as CSSStyleDeclaration);
    explorerBtn.onclick = () => ipcRenderer.invoke("show-in-explorer", att.path);

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕";
    removeBtn.title = "移除";
    Object.assign(removeBtn.style, { background: "none", border: "none", cursor: "pointer", color: "#888", fontSize: "12px" } as CSSStyleDeclaration);
    removeBtn.onclick = () => {
      attachments = attachments.filter((a) => a.path !== att.path);
      renderList();
    };

    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(explorerBtn);
    row.appendChild(removeBtn);
    list.appendChild(row);
  }
}

async function addFiles(files: File[]): Promise<void> {
  const paths = (window as any).piDesktop?.getDroppedFilePaths(files) as string[] | undefined;
  if (!paths?.length) return;

  for (const p of paths) {
    if (attachments.some((a) => a.path === p)) continue;
    const exists = await ipcRenderer.invoke("check-file-exists", p) as boolean;
    attachments.push({ path: p, name: basename(p), exists });
  }
  renderList();

  // Also insert paths into textarea (for the agent to read)
  const ta = document.querySelector("textarea") as HTMLTextAreaElement | null;
  if (ta) {
    const msg = paths.map((p) => `[外部附件 - 文件] ${p}`).join("\n");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) {
      setter.call(ta, ta.value + (ta.value ? "\n" : "") + msg);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.focus();
    }
  }
}

// ─── Init after page loads ───────────────────────────────────────────

function init(): void {
  if (document.getElementById("__pi-desktop-attachments")) return;
  panelEl = buildPanel();
  document.body.appendChild(panelEl);

  // Intercept drop events at capture phase (before pi-web's handler)
  document.addEventListener(
    "drop",
    (e) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) addFiles(files);
    },
    { capture: true }
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
