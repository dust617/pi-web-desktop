#!/usr/bin/env node
/**
 * pi-web:stage — Isolated staging of a new @agegr/pi-web version.
 *
 * Usage: npm run pi-web:stage -- <version>
 * Example: npm run pi-web:stage -- 0.8.1
 *
 * Steps:
 * 1. Verify version matches patch manifest
 * 2. Clone source from git at the pinned commit
 * 3. Fetch npm tarball and verify integrity (shasum + integrity hash)
 * 4. Clean npm ci in staging directory
 * 5. Apply downstream patches from manifest
 * 6. Build (.next)
 * 7. Verify BUILD_ID, routes, provenance
 * 8. Run staged contract tests
 * 9. Write verifiable manifest
 *
 * On success, the staged directory is ready for swap on next cold start.
 */

import { execSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BACKUP_DIR = join(ROOT, ".backup");
const MANIFEST_PATH = join(ROOT, "scripts", "pi-web-patch-manifest.json");
const UI_ADAPTER_PATCH = join(ROOT, "scripts", "pi-web-ui-adapters.patch");

// ─── Helpers ───────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[pi-web:stage] ${msg}`);
}

function fail(msg) {
  console.error(`[pi-web:stage] FAIL: ${msg}`);
  process.exit(1);
}

function run(cmd, opts = {}) {
  const result = spawnSync(cmd, { shell: true, stdio: "inherit", ...opts });
  if (result.status !== 0) {
    throw new Error(`Command failed (exit ${result.status}): ${cmd}`);
  }
  return result;
}

function runCapture(cmd, opts = {}) {
  const result = spawnSync(cmd, {
    shell: true,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(
      `Command failed (exit ${result.status}): ${cmd}\nstderr: ${result.stderr}`
    );
  }
  return result.stdout.trim();
}

function shasum(filePath) {
  const data = readFileSync(filePath);
  return createHash("sha1").update(data).digest("hex");
}

function integrityHash(filePath) {
  const data = readFileSync(filePath);
  return "sha512-" + createHash("sha512").update(data).digest("base64");
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const targetVersion = process.argv[2];
  if (!targetVersion) {
    fail("Usage: npm run pi-web:stage -- <version>");
  }

  log(`Target version: ${targetVersion}`);

  // Load and verify patch manifest
  if (!existsSync(MANIFEST_PATH)) {
    fail(`Patch manifest not found: ${MANIFEST_PATH}`);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  if (manifest.upstream.version !== targetVersion) {
    fail(
      `Manifest version ${manifest.upstream.version} does not match target ${targetVersion}`
    );
  }

  const {
    gitTag,
    gitTagPeeledCommit,
    npmGitHead,
    shasum: expectedShasum,
    integrity: expectedIntegrity,
  } = manifest.upstream;
  log(`Pinned git tag: ${gitTag}`);
  log(`Peeled commit: ${gitTagPeeledCommit}`);
  log(`npm gitHead: ${npmGitHead}`);
  log(`Expected shasum: ${expectedShasum}`);

  // Create staging directory
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stageName = `pi-web-${targetVersion}-staged`;
  const stageDir = join(BACKUP_DIR, stageName);

  if (existsSync(stageDir)) {
    log(`Removing existing staged directory: ${stageDir}`);
    rmSync(stageDir, { recursive: true, force: true });
  }

  // ─── Step 1: Clone source from git ─────────────────────────────────────
  log("Step 1: Cloning source from git...");
  const gitUrl = "https://github.com/agegr/pi-web.git";
  const tmpClone = mkdtempSync(join(BACKUP_DIR, "pi-web-clone-"));

  try {
    run(`git clone --depth 1 --branch ${gitTag} ${gitUrl} ${tmpClone}/repo`);

    // Verify the peeled commit matches the manifest
    const actualHead = runCapture("git rev-parse HEAD", {
      cwd: `${tmpClone}/repo`,
    });
    if (actualHead !== gitTagPeeledCommit) {
      fail(
        `Git HEAD mismatch: expected ${gitTagPeeledCommit}, got ${actualHead}. ` +
          `The tag may have been moved — do not proceed.`
      );
    }
    log(`Verified git HEAD: ${actualHead}`);
  } catch (err) {
    rmSync(tmpClone, { recursive: true, force: true });
    fail(`Git clone failed: ${err.message}`);
  }

  // ─── Step 2: Fetch and verify npm tarball ──────────────────────────────
  log("Step 2: Fetching npm tarball...");
  const tarballPath = join(tmpClone, `agegr-pi-web-${targetVersion}.tgz`);

  try {
    run(`npm pack @agegr/pi-web@${targetVersion}`, { cwd: tmpClone });

    const actualShasum = shasum(tarballPath);
    const actualIntegrity = integrityHash(tarballPath);

    if (actualShasum !== expectedShasum) {
      fail(
        `Tarball shasum mismatch: expected ${expectedShasum}, got ${actualShasum}`
      );
    }
    if (actualIntegrity !== expectedIntegrity) {
      fail(
        `Tarball integrity mismatch: expected ${expectedIntegrity}, got ${actualIntegrity}`
      );
    }
    log(`Verified tarball shasum: ${actualShasum}`);
    log(`Verified tarball integrity: ${actualIntegrity}`);
  } catch (err) {
    rmSync(tmpClone, { recursive: true, force: true });
    fail(`Tarball fetch/verify failed: ${err.message}`);
  }

  // ─── Step 3: Prepare staging directory ─────────────────────────────────
  log("Step 3: Preparing staging directory...");

  // Copy git source to staging
  run(`xcopy /E /I /Q /Y "${tmpClone}\\repo" "${stageDir}"`);

  // Remove upstream .next (we'll rebuild after patching)
  const upstreamNext = join(stageDir, ".next");
  if (existsSync(upstreamNext)) {
    rmSync(upstreamNext, { recursive: true, force: true });
    log("Removed upstream .next (will rebuild after patching)");
  }

  // ─── Step 4: Clean npm ci ──────────────────────────────────────────────
  log("Step 4: Running clean npm CI...");
  try {
    run("npm ci", { cwd: stageDir });
    log("NPM CI completed");
  } catch (err) {
    rmSync(stageDir, { recursive: true, force: true });
    rmSync(tmpClone, { recursive: true, force: true });
    fail(`npm ci failed: ${err.message}`);
  }

  // ─── Step 5: Apply downstream patches ──────────────────────────────────
  log("Step 5: Applying downstream patches...");

  for (const patch of manifest.patches) {
    log(`  Applying patch: ${patch.id}`);

    if (patch.id === "outputFileTracingRoot") {
      // Patch next.config.ts to add outputFileTracingRoot
      const configPath = join(stageDir, "next.config.ts");
      let config = readFileSync(configPath, "utf8");

      if (config.includes("outputFileTracingRoot")) {
        log("    outputFileTracingRoot already present, skipping");
        continue;
      }

      // Insert outputFileTracingRoot
      config = config.replace(
        /const nextConfig: NextConfig = \{/,
        `const nextConfig: NextConfig = {\n  outputFileTracingRoot: __dirname,`
      );
      writeFileSync(configPath, config, "utf8");
      log("    Added outputFileTracingRoot to next.config.ts");
    } else if (patch.id === "archived-sessions-route") {
      // Add archived-sessions route
      const routeDir = join(stageDir, "app", "api", "archived-sessions");
      mkdirSync(routeDir, { recursive: true });

      const routeContent = `import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const ARCHIVE_FILE = path.join(os.homedir(), ".pi", "agent", "archived-sessions.json");

function readArchive(): string[] {
  try {
    const raw = fs.readFileSync(ARCHIVE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x: unknown) => typeof x === "string");
  } catch { /* file doesn't exist or is corrupt */ }
  return [];
}

export async function GET() {
  return NextResponse.json({ ids: readArchive() });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  try {
    fs.mkdirSync(path.dirname(ARCHIVE_FILE), { recursive: true });
    fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(ids, null, 2));
  } catch { /* ignore write errors */ }
  return NextResponse.json({ ok: true });
}
`;
      writeFileSync(join(routeDir, "route.ts"), routeContent, "utf8");
      log("    Added archived-sessions route");
    } else if (patch.id === "directory-browser-windows-paths") {
      const browserPath = join(stageDir, "lib", "directory-browser.ts");
      let browser = readFileSync(browserPath, "utf8");
      // Upstream selects the host-platform `path` object for serialized POSIX
      // paths, which changes `/Users/x` into `\\Users\\x` on Windows.
      if (browser.includes(": path;")) {
        browser = browser.replace(": path;", ": path.posix;");
        writeFileSync(browserPath, browser, "utf8");
        log("    Patched directory browser path semantics");
      } else if (!browser.includes(": path.posix;")) {
        fail("directory-browser parent implementation did not match expected upstream source");
      }
    } else if (patch.id === "isolated-build-home") {
      const buildScriptPath = join(stageDir, "bin", "pi-web-build.mjs");
      const buildScript = `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildHome = join(packageRoot, ".build-home");
mkdirSync(buildHome, { recursive: true });
const result = spawnSync(
  process.execPath,
  [join(packageRoot, "node_modules", "next", "dist", "bin", "next"), "build", "--webpack"],
  {
    cwd: packageRoot,
    env: { ...process.env, HOME: buildHome, USERPROFILE: buildHome },
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
`;
      writeFileSync(buildScriptPath, buildScript, "utf8");

      const pkgPath = join(stageDir, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      pkg.scripts = { ...pkg.scripts, build: "node bin/pi-web-build.mjs" };
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

      const ignorePath = join(stageDir, ".gitignore");
      const ignore = existsSync(ignorePath) ? readFileSync(ignorePath, "utf8") : "";
      if (!ignore.includes("/.build-home/")) {
        writeFileSync(ignorePath, `${ignore.replace(/\s*$/, "")}\n/.build-home/\n`, "utf8");
      }
      log("    Added isolated pi-web build home");
    } else if (patch.id === "test-script") {
      // Add test script to package.json
      const pkgPath = join(stageDir, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

      if (!pkg.scripts) pkg.scripts = {};
      if (!pkg.scripts.test) {
        pkg.scripts.test = "node --test lib/*.test.mjs components/*.test.mjs";
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
        log("    Added test script to package.json");
      } else {
        log("    test script already present, skipping");
      }
    } else if (patch.id === "session-ui-adapters") {
      // Keep UI-specific downstream behavior as one small, fail-closed patch.
      // It is intentionally applied after core source patches; a changed
      // upstream component makes staging fail rather than silently dropping
      // archive/copy/recovery behavior on upgrade.
      if (!existsSync(UI_ADAPTER_PATCH)) fail(`Missing UI adapter patch: ${UI_ADAPTER_PATCH}`);
      // `stageDir` is intentionally not a Git worktree, so use GNU patch
      // rather than `git apply` (which can silently skip paths outside a repo).
      const checked = spawnSync("patch", ["--dry-run", "--batch", "-l", "-p3", "-i", UI_ADAPTER_PATCH], { cwd: stageDir, encoding: "utf8" });
      if (checked.status !== 0) fail(`Session UI adapter patch no longer applies; adapt it before staging:\n${checked.stderr || checked.stdout}`);
      const applied = spawnSync("patch", ["--batch", "-l", "-p3", "-i", UI_ADAPTER_PATCH], { cwd: stageDir, encoding: "utf8" });
      if (applied.status !== 0) fail(`Session UI adapter patch failed:\n${applied.stderr || applied.stdout}`);
      log("    Applied session UI adapters (copy/archive/error/compaction/model recovery)");
    }
  }

  // ─── Step 6: Build ─────────────────────────────────────────────────────
  log("Step 6: Building .next from patched source...");
  try {
    run("npm run build", { cwd: stageDir });
    log("Source build completed");
  } catch (err) {
    // A staged runtime is never allowed to borrow an upstream build artifact:
    // it would omit downstream routes and make the stage unverifiable.
    rmSync(stageDir, { recursive: true, force: true });
    rmSync(tmpClone, { recursive: true, force: true });
    fail(`Source build failed; staging aborted without fallback: ${err.message}`);
  }

  // ─── Step 7: Verify BUILD_ID and routes ────────────────────────────────
  log("Step 7: Verifying BUILD_ID and routes...");

  const buildIdPath = join(stageDir, ".next", "BUILD_ID");
  if (!existsSync(buildIdPath)) {
    fail("BUILD_ID not found after build");
  }
  const buildId = readFileSync(buildIdPath, "utf8").trim();
  log(`  BUILD_ID: ${buildId}`);

  // This downstream API is required by MobileBridge and must be compiled from
  // the patched staged source, not merely present in TypeScript source.
  const archivedRoute = join(
    stageDir,
    ".next",
    "server",
    "app",
    "api",
    "archived-sessions",
    "route.js"
  );
  if (!existsSync(archivedRoute)) {
    rmSync(stageDir, { recursive: true, force: true });
    rmSync(tmpClone, { recursive: true, force: true });
    fail("archived-sessions route not found in source build output");
  }
  log("  archived-sessions route: present");

  // Verify pi-coding-agent version
  const piPkgPath = join(
    stageDir,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "package.json"
  );
  if (existsSync(piPkgPath)) {
    const piPkg = JSON.parse(readFileSync(piPkgPath, "utf8"));
    if (piPkg.version !== manifest.upstream.piCodingAgentVersion) {
      fail(
        `pi-coding-agent version mismatch: expected ${manifest.upstream.piCodingAgentVersion}, got ${piPkg.version}`
      );
    }
    log(`  pi-coding-agent: ${piPkg.version}`);
  }

  // ─── Step 8: Run staged tests ──────────────────────────────────────────
  // Tests run only after the source build and required route checks, but
  // always before the manifest makes this directory eligible for a swap.
  log("Step 8: Running staged pi-web tests...");
  try {
    run("npm test", { cwd: stageDir });
    log("Staged pi-web tests completed");
  } catch (err) {
    rmSync(stageDir, { recursive: true, force: true });
    rmSync(tmpClone, { recursive: true, force: true });
    fail(`Staged pi-web tests failed; staging aborted: ${err.message}`);
  }

  // ─── Step 9: Write stage manifest ──────────────────────────────────────
  log("Step 9: Writing stage manifest...");

  const stageManifest = {
    version: targetVersion,
    gitTag,
    gitTagPeeledCommit,
    npmGitHead,
    shasum: expectedShasum,
    integrity: expectedIntegrity,
    buildId,
    buildFromSource: true,
    requiredCompiledRoutes: ["/api/archived-sessions"],
    stagedAt: new Date().toISOString(),
    nodeVersion: process.version,
    patches: manifest.patches.map((p) => p.id),
    piCodingAgentVersion: manifest.upstream.piCodingAgentVersion,
    tests: { command: "npm test", passed: true },
  };

  writeFileSync(
    join(stageDir, ".stage-manifest.json"),
    JSON.stringify(stageManifest, null, 2) + "\n",
    "utf8"
  );
  log("Stage manifest written");

  // ─── Cleanup ───────────────────────────────────────────────────────────
  log("Cleaning up temporary files...");
  rmSync(tmpClone, { recursive: true, force: true });

  log("");
  log("═══════════════════════════════════════════════════════════");
  log(`✓ pi-web ${targetVersion} staged successfully`);
  log(`  Directory: ${stageDir}`);
  log(`  BUILD_ID: ${buildId}`);
  log(`  Patches applied: ${manifest.patches.map((p) => p.id).join(", ")}`);
  log("");
  log("Next: restart the desktop app to swap the verified staged version into resources/pi-web/");
  log("═══════════════════════════════════════════════════════════");
}

main().catch((err) => {
  fail(err.message || String(err));
});
