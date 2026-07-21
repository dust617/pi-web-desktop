/**
 * Pi Web Desktop – Electron Main Process
 * Thin shell: spawns Pi Web on a dynamic loopback port, loads it in a BrowserWindow.
 */
import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from "electron";
import * as path from "path";
import { PiWebRuntime } from "./pi-web-runtime";

const runtime = new PiWebRuntime();
let mainWindow: BrowserWindow | null = null;

// ─── Window Management ───────────────────────────────────────────────

async function createWindow(): Promise<void> {
  let url: string;

  try {
    const info = await runtime.start();
    url = info.url;
  } catch (err: any) {
    dialog.showErrorBox(
      "Pi Web 启动失败",
      `无法启动 Pi Web 运行时：\n${err.message}\n\n请确认已全局安装 @agegr/pi-web。`
    );
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
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

  // Only allow loading from our local Pi Web instance
  mainWindow.webContents.on("will-navigate", (event, navUrl) => {
    if (!navUrl.startsWith(url)) {
      event.preventDefault();
      shell.openExternal(navUrl);
    }
  });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl.startsWith("http://127.0.0.1") || targetUrl.startsWith("http://localhost")) {
      return { action: "allow" };
    }
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  await mainWindow.loadURL(url);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── IPC Handlers ────────────────────────────────────────────────────

ipcMain.handle("get-runtime-info", () => runtime.info);

ipcMain.handle("select-files", async (_event, options?: { directories?: boolean }) => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: options?.directories
      ? ["openDirectory", "multiSelections"]
      : ["openFile", "multiSelections"],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("show-in-explorer", (_event, filePath: string) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle("get-version", () => ({
  app: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
}));

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
          label: "退出 (&Q)",
          accelerator: "Ctrl+Q",
          click: () => app.quit(),
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
            dialog.showMessageBox({
              title: "关于",
              message: `Pi Web Desktop v${app.getVersion()}`,
              detail: `Electron: ${process.versions.electron}\nNode: ${process.versions.node}\nPi Web: @agegr/pi-web (locked)`,
            });
          },
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

// ─── App Lifecycle ───────────────────────────────────────────────────

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    buildMenu();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    runtime.stop();
    app.quit();
  });

  app.on("before-quit", () => {
    runtime.stop();
  });
}
