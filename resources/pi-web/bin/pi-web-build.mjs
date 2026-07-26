#!/usr/bin/env node
/**
 * Build pi-web without inspecting the interactive user's home directory.
 *
 * Some Pi runtime imports glob user-level paths during Next's trace phase.
 * Windows junctions in a real profile can be unreadable, so build tracing is
 * isolated to a disposable directory inside this package.
 */
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
