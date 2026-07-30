/**
 * Pi Web Desktop – Electron Main Process
 * Stage 1: tray, window state memory, enhanced menu, detailed error dialogs.
 */
import { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage, clipboard } from "electron";
import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { PiWebRuntime } from "./pi-web-runtime";
import { MobileBridge, resolveAllowedOrigins } from "./mobile-bridge";
import { FrpcGuardian, guardianStateLabel, formatUptime } from "./frpc-guardian";

interface ProjectOpenRequest {
  requestId: string;
  projectDir: string;
}

const runtime = new PiWebRuntime();

// ─── Staged pi-web Upgrade Auto-Swap ─────────────────────────────────
// When a newer pi-web tarball has been unpacked into .backup/pi-web-*-staged,
// swap it into resources/pi-web on next cold start (the running instance holds
// an exclusive lock on the old directory, so we cannot hot-swap). If the swap
// fails (e.g. another instance still holds the lock), we log and continue with
// the old version — the next restart will retry.
const REQUIRED_STAGED_PI_WEB_ROUTE = "/api/archived-sessions";

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function isVerifiedStagedPiWeb(stageDir: string, packageVersion: string): boolean {
  try {
    const manifestPath = path.join(stageDir, ".stage-manifest.json");
    if (!fs.existsSync(manifestPath)) throw new Error("missing stage manifest");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      version?: unknown;
      buildFromSource?: unknown;
      buildId?: unknown;
      requiredCompiledRoutes?: unknown;
      gitTag?: unknown;
      gitTagPeeledCommit?: unknown;
      npmGitHead?: unknown;
      shasum?: unknown;
      integrity?: unknown;
      tests?: { command?: unknown; passed?: unknown };
    };
    const provenanceFields = ["gitTag", "gitTagPeeledCommit", "npmGitHead", "shasum", "integrity"] as const;
    if (manifest.version !== packageVersion) throw new Error("manifest/package version mismatch");
    if (manifest.buildFromSource !== true) throw new Error("stage was not built from source");
    if (!provenanceFields.every((field) => typeof manifest[field] === "string" && manifest[field].length > 0)) {
      throw new Error("missing stage provenance");
    }
    if (!Array.isArray(manifest.requiredCompiledRoutes) || !manifest.requiredCompiledRoutes.includes(REQUIRED_STAGED_PI_WEB_ROUTE)) {
      throw new Error(`missing required route declaration: ${REQUIRED_STAGED_PI_WEB_ROUTE}`);
    }
    if (manifest.tests?.command !== "npm test" || manifest.tests.passed !== true) {
      throw new Error("staged pi-web tests were not recorded as passed");
    }
    const buildIdPath = path.join(stageDir, ".next", "BUILD_ID");
    if (!fs.existsSync(buildIdPath) || fs.readFileSync(buildIdPath, "utf8").trim() !== manifest.buildId) {
      throw new Error("BUILD_ID does not match manifest");
    }
    const archiveRoute = path.join(stageDir, ".next", "server", "app", "api", "archived-sessions", "route.js");
    if (!fs.existsSync(archiveRoute)) throw new Error("compiled archived-sessions route is missing");
    return true;
  } catch (err) {
    console.warn(`[main] rejecting staged pi-web at ${stageDir}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function tryApplyStagedPiWebUpgrade(): void {
  // Packaged resources live inside app.asar/app.asar.unpacked and must be
  // upgraded by a signed installer, never by mutating the installation tree.
  if (app.isPackaged) return;
  const backupDir = path.join(__dirname, "..", ".backup");
  if (!fs.existsSync(backupDir)) return;
  let stagedDir: string | null = null;
  let stagedVersion = "0.0.0";
  try {
    const entries = fs.readdirSync(backupDir);
    for (const name of entries) {
      if (/^pi-web-[\d.]+-staged$/.test(name)) {
        const pkgPath = path.join(backupDir, name, "package.json");
        if (fs.existsSync(pkgPath)) {
          try {
            const ver = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version as string;
            const candidate = path.join(backupDir, name);
            if (!isVerifiedStagedPiWeb(candidate, ver)) continue;
            // Compare versions and pick the highest verified stage.
            if (compareVersions(ver, stagedVersion) > 0) {
              stagedVersion = ver;
              stagedDir = candidate;
            }
          } catch {
            // Skip an unreadable or invalid staged package.
          }
        }
      }
    }
  } catch { return; }
  if (!stagedDir) return;

  const currentPkg = path.join(__dirname, "..", "resources", "pi-web", "package.json");
  if (!fs.existsSync(currentPkg)) return;

  let movedCurrentTo: string | null = null;
  try {
    const currentVer = JSON.parse(fs.readFileSync(currentPkg, "utf8")).version as string;
    if (stagedVersion === currentVer) return; // already up-to-date

    console.log(`[main] staged pi-web ${stagedVersion} detected (current: ${currentVer}), attempting swap...`);
    const targetDir = path.join(__dirname, "..", "resources", "pi-web");
    const oldDir = path.join(backupDir, `pi-web-${currentVer}-old-${Date.now()}`);

    fs.renameSync(targetDir, oldDir);
    movedCurrentTo = oldDir;
    try {
      fs.renameSync(stagedDir, targetDir);
      movedCurrentTo = null;
    } catch (swapErr) {
      // The old runtime has already moved; restore it synchronously before the
      // app continues so a failed staged upgrade cannot brick the next start.
      fs.renameSync(oldDir, targetDir);
      movedCurrentTo = null;
      throw swapErr;
    }
    console.log(`[main] pi-web upgraded ${currentVer} -> ${stagedVersion} (old backup: ${oldDir})`);
  } catch (err) {
    console.warn(`[main] staged pi-web swap failed (old runtime preserved): ${err instanceof Error ? err.message : String(err)}`);
    if (movedCurrentTo) {
      console.error(`[main] staged pi-web rollback needs manual recovery from ${movedCurrentTo}`);
    }
  }
}
tryApplyStagedPiWebUpgrade();

let mobileBridge: MobileBridge | null = null;
const frpcGuardian = new FrpcGuardian();
let mainWindow: BrowserWindow | null = null;
let windowReadyPromise: Promise<void> | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let projectDir: string | undefined;
let projectSwitchQueue: Promise<void> = Promise.resolve();
let pendingProjectTimer: NodeJS.Timeout | null = null;
const processedProjectRequests = new Set<string>();
const PENDING_DIR = path.join(app.getPath("userData"), "pending-projects");
const DEBUG_LOG = path.join(app.getPath("userData"), "argv-debug.log");

function debugLog(message: string): void {
  try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${message}\n`); } catch {}
}

function normalizeProjectDir(candidate: string): string | undefined {
  try {
    const resolved = path.resolve(candidate);
    if (!fs.statSync(resolved).isDirectory()) return undefined;
    return fs.realpathSync.native(resolved);
  } catch {
    return undefined;
  }
}

// Parse --project <path> or --project=<path> from this process's original argv.
function parseProjectDir(argv: string[]): string | undefined {
  debugLog(`argv: ${JSON.stringify(argv)}`);
  let candidate: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--project" && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      candidate = argv[i + 1];
      break;
    }
    if (argv[i].startsWith("--project=")) {
      candidate = argv[i].slice("--project=".length);
      break;
    }
  }
  const normalized = candidate ? normalizeProjectDir(candidate) : undefined;
  debugLog(`parsed project=${candidate ?? "(none)"} normalized=${normalized ?? "(invalid/none)"}`);
  return normalized;
}

projectDir = parseProjectDir(process.argv);
const launchProjectRequest: ProjectOpenRequest | undefined = projectDir
  ? { requestId: `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`, projectDir }
  : undefined;
console.log("[main] initial projectDir:", projectDir);

function writePendingProjectRequest(request: ProjectOpenRequest): void {
  const safeId = request.requestId.replace(/[^A-Za-z0-9._-]/g, "_");
  const finalFile = path.join(PENDING_DIR, `${safeId}.json`);
  const tempFile = path.join(PENDING_DIR, `${safeId}.${process.pid}.tmp`);
  try {
    fs.mkdirSync(PENDING_DIR, { recursive: true });
    fs.writeFileSync(tempFile, JSON.stringify(request), "utf8");
    fs.renameSync(tempFile, finalFile);
    debugLog(`pending request written: ${JSON.stringify(request)}`);
  } catch (err) {
    try { fs.unlinkSync(tempFile); } catch {}
    debugLog(`pending request write failed: ${String(err)}`);
  }
}

// ─── Shared App Icon ─────────────────────────────────────────────────

const ICON_PATH = path.join(__dirname, "..", "resources", "icon.png");
// High-contrast tray badge (white-haloed disc) so the icon stays visible on
// dark Windows taskbars. The legacy icon-32.png was a dark-teel π on a fully
// transparent background, which vanished against dark taskbars ("black &
// unreadable"). Fall back to the legacy file / a resized app icon if missing.
const TRAY_ICON_PATH = path.join(__dirname, "..", "resources", "tray-icon.png");
const TRAY_ICON_LEGACY_PATH = path.join(__dirname, "..", "resources", "icon-32.png");
const APP_ICON = fs.existsSync(ICON_PATH)
  ? nativeImage.createFromPath(ICON_PATH)
  : nativeImage.createEmpty();
const TRAY_ICON = (() => {
  const p = fs.existsSync(TRAY_ICON_PATH)
    ? TRAY_ICON_PATH
    : fs.existsSync(TRAY_ICON_LEGACY_PATH)
      ? TRAY_ICON_LEGACY_PATH
      : null;
  return p ? nativeImage.createFromPath(p) : APP_ICON.resize({ width: 32, height: 32 });
})();

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
    const initialProjectDir = projectDir;
    const info = await runtime.start(initialProjectDir);
    url = await getProjectUrl(info.url, initialProjectDir);
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
    icon: APP_ICON,
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
    windowReadyPromise = null;
  });

  // Only allow navigation to our current local Pi Web instance
  mainWindow.webContents.on("will-navigate", (event, navUrl) => {
    if (!isRuntimeUrl(navUrl)) {
      event.preventDefault();
      if (navUrl.startsWith("https:")) shell.openExternal(navUrl);
    }
  });

  // External links: current runtime origin or external HTTPS only.
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isRuntimeUrl(targetUrl)) return { action: "allow" };
    if (targetUrl.startsWith("https:")) shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  console.log("[main] loading URL:", url);
  mainWindow.webContents.on("did-finish-load", () => console.log("[main] page loaded OK"));
  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => console.error("[main] page FAILED:", code, desc));

  // Right-click context menu for editable fields (textarea/input)
  mainWindow.webContents.on("context-menu", (event, params) => {
    if (params.isEditable) {
      event.preventDefault();
      const menu = Menu.buildFromTemplate([
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ]);
      menu.popup({ window: mainWindow! });
    }
  });

  // Shell-level paste hardening (see materializeClipboardImageIfNeeded).
  // Fires on the keyDown that triggers paste, before the DOM paste event is
  // synthesized, so the frontend reads already-materialized PNG data.
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.type !== "keyDown") return;
    const isPaste =
      ((input.control || input.meta) && input.key.toLowerCase() === "v") ||
      (input.shift && input.key === "Insert");
    if (isPaste) materializeClipboardImageIfNeeded();
  });

  await mainWindow.loadURL(url);
  console.log("[main] loadURL resolved");
}

// ─── Clipboard Paste Hardening ───────────────────────────────────────
// Windows places copied screenshots / copied images on the clipboard as
// delayed-rendering CF_BITMAP handles. The locked pi-web frontend reads paste
// data lazily, so depending on render timing the image sometimes arrives empty
// -> a broken / transparent attachment thumbnail, and paste "works again" after
// a session switch re-mounts the input. We cannot edit the locked frontend, so
// at the shell level we *materialize* the clipboard image into a concrete PNG
// right before the paste keystroke is dispatched, making the subsequent DOM
// paste event see stable data. We only act on a pure-image clipboard (no text)
// so normal text paste and the frontend's own handling are never disturbed.
function materializeClipboardImageIfNeeded(): void {
  try {
    const text = clipboard.readText();
    if (text && text.trim().length > 0) return; // text present -> leave alone
    const img = clipboard.readImage();
    if (!img || img.isEmpty()) return;          // no image -> nothing to do
    clipboard.writeImage(img);                  // force CF_BITMAP -> PNG
  } catch {
    // clipboard quirks must never break typing / pasting
  }
}

// ─── Tray ────────────────────────────────────────────────────────────

function createTray(): void {
  // Rebuilding the tray menu (e.g. after the pairing code changes) used to
  // create a *second* system-tray icon because the previous Tray instance was
  // never destroyed. Always tear down the old one first.
  if (tray) {
    try { tray.destroy(); } catch { /* ignore */ }
    tray = null;
  }
  tray = new Tray(TRAY_ICON);
  tray.setToolTip("Pi Web Desktop");

  // ── 隧道守护状态 ──
  const gs = frpcGuardian.getStatus();
  const stateIcon = gs.state === "running" ? "●" : gs.state === "blocked" ? "✖" : gs.state === "stopped" ? "○" : "◌";
  const tunnelLabel = gs.state === "running"
    ? `隧道: ${stateIcon} ${guardianStateLabel(gs.state)} (PID ${gs.pid}, ${formatUptime(gs.uptimeMs)})`
    : `隧道: ${stateIcon} ${guardianStateLabel(gs.state)}${gs.lastError ? ` - ${gs.lastError.slice(0, 40)}` : ""}`;

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
          const info = await runtime.start(projectDir);
          const targetUrl = await getProjectUrl(info.url, projectDir);
          await mainWindow?.loadURL(targetUrl);
          showMainWindow();
        } catch (err: any) {
          dialog.showErrorBox("重启失败", err.message);
        }
      },
    },
    { type: "separator" },
    // ── 开机自启 ──
    {
      label: "开机自启",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
      },
    },
    { type: "separator" },
    // ── frpc 隧道守护 ──
    {
      label: tunnelLabel,
      enabled: false,
    },
    ...(gs.state === "stopped"
      ? [{
          label: "启动隧道守护",
          click: () => { frpcGuardian.start().catch((e: any) => dialog.showErrorBox("隧道启动失败", e.message)); },
        }]
      : []),
    ...(gs.state === "running" || gs.state === "restarting" || gs.state === "starting"
      ? [{
          label: "停止隧道守护",
          click: () => { frpcGuardian.stop().catch(() => {}); },
        }]
      : []),
    ...(gs.state === "blocked"
      ? [{
          label: "解除熔断并重试",
          click: () => { frpcGuardian.unblockAndRestart().catch((e: any) => dialog.showErrorBox("隧道重试失败", e.message)); },
        }]
      : []),
    ...(gs.state !== "stopped"
      ? [{
          label: "重启隧道",
          click: () => { frpcGuardian.restart().catch((e: any) => dialog.showErrorBox("隧道重启失败", e.message)); },
        }]
      : []),
    { type: "separator" },
    {
      label: `移动端配对码: ${mobileBridge?.pairingCode ?? "..."}`,
      enabled: false,
    },
    ...(resolveAllowedOrigins().length === 0
      ? [{ label: "移动端: 仅本机模式 (PI_MOBILE_ORIGIN 为空)", enabled: false }]
      : []),
    {
      label: "复制配对码",
      click: () => {
        const code = mobileBridge?.pairingCode;
        if (code) {
          require("electron").clipboard.writeText(code);
          dialog.showMessageBox({ title: "配对码", message: `已复制: ${code}` });
        }
      },
    },
    {
      label: "刷新配对码 (吊销所有手机会话)",
      click: () => {
        if (!mobileBridge) return;
        // Truly rotate: new code + revoke every existing mobile session (P2-2).
        const code = mobileBridge.rotateCode();
        createTray(); // rebuild menu so the displayed code updates
        dialog.showMessageBox({
          title: "配对码已刷新",
          message: `新配对码: ${code}\n\n旧配对码及所有已登录的手机会话已吊销。`,
        });
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
  if (!isRuntimeUrl(senderUrl)) throw new Error(`IPC rejected: untrusted sender frame ${senderUrl}`);
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

// ─── Image drag-drop fallback ────────────────────────────────────────
// Windows drag-drop from Snipping Tool / browser can hand out File objects
// with empty or undecodable data (raw DIB, lazy shell virtual files).
// Read the real file from disk via nativeImage and re-encode as PNG.
ipcMain.handle("read-image-as-png", (event, filePath: string): string | null => {
  assertLocalSender(event);
  if (typeof filePath !== "string" || filePath.length === 0) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;
    return img.toPNG().toString("base64");
  } catch {
    return null;
  }
});

// ─── Context Menu Registration ──────────────────────────────────────

function getContextMenuCommand(targetToken: "%1" | "%V"): string {
  if (app.isPackaged) {
    // Packaged: exe is process.execPath
    return `"${process.execPath}" --project "${targetToken}"`;
  }
  // Development: electron.exe + an absolute app directory keeps app identity stable.
  const electronExe = process.execPath;
  const appDir = path.resolve(__dirname, "..");
  return `"${electronExe}" "${appDir}" --project "${targetToken}"`;
}

function escapeRegistryString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function registerContextMenu(): void {
  const selectedDirectoryCmd = getContextMenuCommand("%1");
  const directoryBackgroundCmd = getContextMenuCommand("%V");
  const icon = app.isPackaged ? process.execPath : path.join(__dirname, "..", "resources", "icon.ico");
  // .exe/.dll need ",0" to extract the first icon resource; standalone .ico does not.
  const iconReg = app.isPackaged ? `${icon.replace(/\\/g, "\\\\")},0` : icon.replace(/\\/g, "\\\\");
  const regScript = [
    `Windows Registry Editor Version 5.00`,
    ``,
    `[HKEY_CLASSES_ROOT\\Directory\\shell\\PiWebDesktop]`,
    `@="在此打开 Pi Web"`,
    `"Icon"="${iconReg}"`,
    ``,
    `[HKEY_CLASSES_ROOT\\Directory\\shell\\PiWebDesktop\\command]`,
    `@="${escapeRegistryString(selectedDirectoryCmd)}"`,
    ``,
    `[HKEY_CLASSES_ROOT\\Directory\\Background\\shell\\PiWebDesktop]`,
    `@="在此打开 Pi Web"`,
    `"Icon"="${iconReg}"`,
    ``,
    `[HKEY_CLASSES_ROOT\\Directory\\Background\\shell\\PiWebDesktop\\command]`,
    `@="${escapeRegistryString(directoryBackgroundCmd)}"`,
  ].join("\r\n");

  const tmpReg = path.join(app.getPath("temp"), "pi-web-context-menu.reg");
  fs.writeFileSync(tmpReg, regScript, "utf8");
  try {
    execSync(`regedit /s "${tmpReg}"`, { windowsHide: true });
    dialog.showMessageBox({ title: "右键菜单", message: "已注册：在文件夹右键 → 在此打开 Pi Web" });
  } catch (err: any) {
    dialog.showErrorBox("注册失败", `需要管理员权限或手动导入：\n${tmpReg}\n\n${err.message}`);
  }
}

function unregisterContextMenu(): void {
  const regScript = [
    `Windows Registry Editor Version 5.00`,
    ``,
    `[-HKEY_CLASSES_ROOT\\Directory\\shell\\PiWebDesktop]`,
    ``,
    `[-HKEY_CLASSES_ROOT\\Directory\\Background\\shell\\PiWebDesktop]`,
  ].join("\r\n");

  const tmpReg = path.join(app.getPath("temp"), "pi-web-context-menu-remove.reg");
  fs.writeFileSync(tmpReg, regScript, "utf8");
  try {
    execSync(`regedit /s "${tmpReg}"`, { windowsHide: true });
    dialog.showMessageBox({ title: "右键菜单", message: "已移除右键菜单项" });
  } catch (err: any) {
    dialog.showErrorBox("移除失败", err.message);
  }
}

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
          click: () => shell.openPath(projectDir ?? process.cwd()),
        },
        {
          label: "在资源管理器中显示",
          click: () => {
            const cwd = projectDir ?? process.cwd();
            if (fs.existsSync(cwd)) shell.showItemInFolder(cwd);
          },
        },
        { type: "separator" },
        {
          label: "最小化到托盘",
          click: () => mainWindow?.hide(),
        },
        { type: "separator" },
        {
          label: "注册文件夹右键菜单",
          click: () => registerContextMenu(),
        },
        {
          label: "移除文件夹右键菜单",
          click: () => unregisterContextMenu(),
        },
        { type: "separator" },
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

// ─── Project Switching ──────────────────────────────────────────────

function isRuntimeUrl(targetUrl: string): boolean {
  const baseUrl = runtime.info?.url;
  if (!baseUrl) return false;
  try {
    return new URL(targetUrl).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

async function getProjectUrl(baseUrl: string, cwd?: string): Promise<string> {
  if (!cwd) return baseUrl;
  // The locked pi-web client recognizes cwd and enters its native unsaved-new-session state.
  // This keeps the visible project and the agent/tool cwd identical without creating a fake empty session.
  return `${baseUrl}/?cwd=${encodeURIComponent(cwd)}`;
}

function showMainWindow(): void {
  if (!mainWindow) return;
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function ensureWindow(): Promise<void> {
  if (mainWindow) return Promise.resolve();
  if (!windowReadyPromise) {
    windowReadyPromise = createWindow().finally(() => {
      if (!mainWindow) windowReadyPromise = null;
    });
  }
  return windowReadyPromise;
}

async function openProjectDirectory(rawDir: string): Promise<void> {
  const normalized = normalizeProjectDir(rawDir);
  if (!normalized) throw new Error(`项目目录不存在或不是文件夹：${rawDir}`);

  await app.whenReady();
  await ensureWindow();
  const info = runtime.info ?? await runtime.start(normalized);
  const targetUrl = await getProjectUrl(info.url, normalized);
  if (!mainWindow) throw new Error("主窗口尚未创建");

  await mainWindow.loadURL(targetUrl);
  projectDir = normalized;
  showMainWindow();
  debugLog(`project opened cwd=${normalized} url=${targetUrl}`);
}

function rememberProjectRequest(requestId: string): boolean {
  if (processedProjectRequests.has(requestId)) return false;
  processedProjectRequests.add(requestId);
  if (processedProjectRequests.size > 200) {
    const oldest = processedProjectRequests.values().next().value as string | undefined;
    if (oldest) processedProjectRequests.delete(oldest);
  }
  return true;
}

function queueProjectOpen(request: ProjectOpenRequest, source: string): void {
  if (!rememberProjectRequest(request.requestId)) {
    debugLog(`duplicate project request ignored source=${source} id=${request.requestId}`);
    return;
  }
  debugLog(`project request queued source=${source} ${JSON.stringify(request)}`);
  projectSwitchQueue = projectSwitchQueue
    .then(() => openProjectDirectory(request.projectDir))
    .catch((err) => {
      debugLog(`project request failed source=${source}: ${String(err)}`);
      dialog.showErrorBox("切换项目失败", err instanceof Error ? err.message : String(err));
    });
}

function parseAdditionalProjectRequest(data: unknown): ProjectOpenRequest | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  if (typeof record.requestId !== "string" || typeof record.projectDir !== "string") return undefined;
  return { requestId: record.requestId, projectDir: record.projectDir };
}

function consumePendingProjectRequest(): void {
  if (!fs.existsSync(PENDING_DIR)) return;
  let files: string[];
  try {
    files = fs.readdirSync(PENDING_DIR).filter((name) => name.endsWith(".json")).sort();
  } catch (err) {
    debugLog(`pending request directory read failed: ${String(err)}`);
    return;
  }

  for (const name of files) {
    const requestFile = path.join(PENDING_DIR, name);
    try {
      const raw = fs.readFileSync(requestFile, "utf8").trim();
      fs.unlinkSync(requestFile);
      const parsed = JSON.parse(raw) as Partial<ProjectOpenRequest>;
      if (typeof parsed.requestId === "string" && typeof parsed.projectDir === "string") {
        queueProjectOpen({ requestId: parsed.requestId, projectDir: parsed.projectDir }, "pending-file");
      } else {
        debugLog(`invalid pending request ${name}: ${raw}`);
      }
    } catch (err) {
      try { fs.unlinkSync(requestFile); } catch {}
      debugLog(`pending request read failed ${name}: ${String(err)}`);
    }
  }
}

// ─── App Lifecycle ───────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock(launchProjectRequest ?? {});
if (!gotLock) {
  // additionalData is primary; this atomic file is a fallback for development launches
  // where Electron occasionally fails to deliver second-instance.
  if (launchProjectRequest) writePendingProjectRequest(launchProjectRequest);
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine, workingDirectory, additionalData) => {
    debugLog(`second-instance argv=${JSON.stringify(commandLine)} cwd=${workingDirectory} data=${JSON.stringify(additionalData)}`);
    const request = parseAdditionalProjectRequest(additionalData);
    if (request) queueProjectOpen(request, "second-instance");
    else showMainWindow();
  });

  app.whenReady().then(() => {
    buildMenu();
    createTray();

    // ── frpc 隧道守护：随桌面端启动，状态变化时刷新托盘 ──
    frpcGuardian.on("stateChange", () => createTray());
    if (frpcGuardian.isConfigured()) {
      frpcGuardian.start().catch((err) =>
        console.error("[main] frpc guardian start failed:", err.message),
      );
    } else {
      console.warn("[main] frpc not configured, guardian idle");
    }

    // Crash recovery: restart on a new port, then explicitly restore the project session.
    runtime.onCrash = (code, signal) => {
      dialog
        .showMessageBox({
          type: "warning",
          title: "Pi Web 意外退出",
          message: `Pi Web 服务意外退出（退出码：${code ?? signal ?? "unknown"}）`,
          buttons: ["重启服务", "忽略"],
          defaultId: 0,
        })
        .then(async ({ response }) => {
          if (response !== 0) return;
          try {
            const info = await runtime.start(projectDir);
            const targetUrl = await getProjectUrl(info.url, projectDir);
            await mainWindow?.loadURL(targetUrl);
            showMainWindow();
          } catch (err: any) {
            dialog.showErrorBox("重启失败", err.message);
          }
        });
    };

    void ensureWindow().then(async () => {
      // Start MobileBridge after window is ready (needs runtime.info)
      try {
        mobileBridge = new MobileBridge({
          runtime,
          allowedOrigins: resolveAllowedOrigins(),
          sessionStorePath: path.join(app.getPath("userData"), "mobile-sessions.json"),
        });
        const bridgePort = await mobileBridge.start();
        console.log(`[main] MobileBridge started on port ${bridgePort}`);
        createTray(); // refresh tray with pairing code
      } catch (err: any) {
        console.error("[main] MobileBridge start failed:", err.message);
        // Non-fatal: mobile features unavailable, desktop still works
      }
    }).catch((err) => debugLog(`initial window failed: ${String(err)}`));

    // File fallback is single-consumer and request-id deduplicated with second-instance.
    consumePendingProjectRequest();
    pendingProjectTimer = setInterval(consumePendingProjectRequest, 400);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void ensureWindow().catch((err) => dialog.showErrorBox("窗口创建失败", String(err)));
      } else {
        showMainWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    // Don't quit on macOS-style; on Windows minimize to tray.
  });

  app.on("before-quit", () => {
    isQuitting = true;
    if (pendingProjectTimer) clearInterval(pendingProjectTimer);
    if (mainWindow) saveWindowState(mainWindow);
    mobileBridge?.stop().catch(() => {});
    frpcGuardian.stop().catch(() => {});
    runtime.stop();
  });
}
