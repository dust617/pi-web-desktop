/**
 * Pi Web Desktop – Electron Main Process
 * Stage 1: tray, window state memory, enhanced menu, detailed error dialogs.
 */
import { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage } from "electron";
import * as path from "path";
import * as fs from "fs";
import { PiWebRuntime } from "./pi-web-runtime";

const runtime = new PiWebRuntime();
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// ─── Window State Persistence ────────────────────────────────────────

const STATE_FILE = path.join(app.getPath("userData"), "window-state.json");

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

function loadWindowState(): WindowState {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const state = JSON.parse(raw) as WindowState;
    return {
      width: Math.max(800, state.width ?? 1280),
      height: Math.max(600, state.height ?? 860),
      x: state.x,
      y: state.y,
      isMaximized: state.isMaximized ?? false,
    };
  } catch {
    return { width: 1280, height: 860 };
  }
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const bounds = win.getBounds();
    const state: WindowState = {
      ...bounds,
      isMaximized: win.isMaximized(),
    };
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // ignore write errors
  }
}

// ─── Window Management ───────────────────────────────────────────────

async function createWindow(): Promise<void> {
  let url: string;

  try {
    const info = await runtime.start();
    url = info.url;
  } catch (err: any) {
    const detail = [
      `错误信息：${err.message}`,
      ``,
      `可能原因：`,
      `• Node.js 未安装或不在 PATH 中`,
      `• resources/pi-web/ 目录缺失或损坏`,
      `• 端口被占用（已尝试动态端口）`,
      ``,
      `请确认已安装 Node.js 并重新运行。`,
    ].join("\n");
    dialog.showErrorBox("Pi Web 启动失败", detail);
    app.quit();
    return;
  }

  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 800,
    minHeight: 600,
    title: "Pi Web Desktop",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (state.isMaximized) mainWindow.maximize();

  // Save state on resize/move (debounced via close event)
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      // Minimize to tray instead of closing
      e.preventDefault();
      mainWindow?.hide();
    } else {
      if (mainWindow) saveWindowState(mainWindow);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Only allow navigation to our local Pi Web instance
  mainWindow.webContents.on("will-navigate", (event, navUrl) => {
    if (!navUrl.startsWith(url)) {
      event.preventDefault();
      if (navUrl.startsWith("https:")) shell.openExternal(navUrl);
    }
  });

  // External links: https only
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl.startsWith("http://127.0.0.1") || targetUrl.startsWith("http://localhost")) {
      return { action: "allow" };
    }
    if (targetUrl.startsWith("https:")) shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  console.log("[main] loading URL:", url);
  mainWindow.webContents.on("did-finish-load", () => console.log("[main] page loaded OK"));
  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => console.error("[main] page FAILED:", code, desc));
  mainWindow.webContents.on("console-message", (_e, level, msg) => {
    if (level >= 2) console.error("[renderer]", msg);
  });
  await mainWindow.loadURL(url);
  console.log("[main] loadURL resolved");
}

// ─── Tray ────────────────────────────────────────────────────────────

function createTray(): void {
  // 16x16 simple icon (blue circle) generated at runtime
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA" +
      "OklEQVQ4y2NgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgY" +
      "BaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFAAqEAAGeMKHpAAAAAElFTkSuQmCC",
      "base64"
    )
  );

  tray = new Tray(icon);
  tray.setToolTip("Pi Web Desktop");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示窗口",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: "刷新 Pi Web",
      click: () => mainWindow?.webContents.reload(),
    },
    { type: "separator" },
    {
      label: "重启 Pi Web 服务",
      click: async () => {
        runtime.stop();
        try {
          const info = await runtime.start();
          await mainWindow?.loadURL(info.url);
          mainWindow?.show();
        } catch (err: any) {
          dialog.showErrorBox("重启失败", err.message);
        }
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// ─── IPC Handlers ────────────────────────────────────────────────────

function assertLocalSender(event: Electron.IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url ?? "";
  if (!senderUrl.startsWith("http://127.0.0.1") && !senderUrl.startsWith("http://localhost")) {
    throw new Error(`IPC rejected: untrusted sender frame ${senderUrl}`);
  }
}

ipcMain.handle("get-runtime-info", (event) => {
  assertLocalSender(event);
  return runtime.info;
});

ipcMain.handle("select-files", async (event, options?: { directories?: boolean }) => {
  assertLocalSender(event);
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: options?.directories
      ? ["openDirectory", "multiSelections"]
      : ["openFile", "multiSelections"],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("show-in-explorer", (event, filePath: string) => {
  assertLocalSender(event);
  // Only allow showing paths that exist (prevent arbitrary shell execution)
  if (typeof filePath !== "string" || filePath.length === 0) return;
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
  }
});

ipcMain.handle("get-version", (event) => {
  assertLocalSender(event);
  return {
    app: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
  };
});

ipcMain.handle("check-file-exists", (event, filePath: string): boolean => {
  assertLocalSender(event);
  if (typeof filePath !== "string" || filePath.length === 0) return false;
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
});

// ─── Menu ────────────────────────────────────────────────────────────

function buildMenu(): void {
  const menu = Menu.buildFromTemplate([
    {
      label: "文件 (&F)",
      submenu: [
        {
          label: "刷新 (&R)",
          accelerator: "F5",
          click: () => mainWindow?.webContents.reload(),
        },
        {
          label: "强制刷新",
          accelerator: "Ctrl+Shift+R",
          click: () => mainWindow?.webContents.reloadIgnoringCache(),
        },
        { type: "separator" },
        {
          label: "打开项目目录",
          click: () => shell.openPath(app.getPath("userData")),
        },
        {
          label: "在资源管理器中显示",
          click: () => {
            const cwd = process.cwd();
            if (fs.existsSync(cwd)) shell.showItemInFolder(cwd);
          },
        },
        { type: "separator" },
        {
          label: "最小化到托盘",
          click: () => mainWindow?.hide(),
        },
        {
          label: "退出 (&Q)",
          accelerator: "Ctrl+Q",
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: "视图 (&V)",
      submenu: [
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { role: "resetZoom", label: "重置缩放" },
        { type: "separator" },
        { role: "toggleDevTools", label: "开发者工具" },
      ],
    },
    {
      label: "帮助 (&H)",
      submenu: [
        {
          label: "关于 Pi Web Desktop",
          click: () => {
            const info = runtime.info;
            dialog.showMessageBox({
              title: "关于",
              message: `Pi Web Desktop v${app.getVersion()}`,
              detail: [
                `Electron: ${process.versions.electron}`,
                `Node: ${process.versions.node}`,
                `Pi Web: @agegr/pi-web (locked)`,
                info ? `运行端口: ${info.port}` : "Pi Web 未运行",
              ].join("\n"),
            });
          },
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

// ─── App Lifecycle ───────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    buildMenu();
    createTray();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else mainWindow?.show();
    });
  });

  app.on("window-all-closed", () => {
    // Don't quit on macOS-style; on Windows minimize to tray
    // Only quit when isQuitting is true (from tray/menu)
  });

  app.on("before-quit", () => {
    isQuitting = true;
    if (mainWindow) saveWindowState(mainWindow);
    runtime.stop();
  });
}
