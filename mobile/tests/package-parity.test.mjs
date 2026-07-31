// Release gate: verify the unpacked app.asar contains the reviewed/current
// MobileBridge and PWA files, not a stale pre-security-fix build.
//   node mobile/tests/package-parity.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const root = new URL("../../", import.meta.url);
const asarPath = fileURLToPath(new URL("../../release/win-unpacked/resources/app.asar", import.meta.url));
assert.ok(fs.existsSync(asarPath), "release/win-unpacked/resources/app.asar is missing; run npm run dist first");

const files = [
  ["dist/mobile-bridge.js", "dist/mobile-bridge.js"],
  ["dist/main.js", "dist/main.js"],
  ["resources/mobile/index.html", "resources\\mobile\\index.html"],
  ["resources/mobile/sw.js", "resources\\mobile\\sw.js"],
  ["resources/mobile/manifest.json", "resources\\mobile\\manifest.json"],
];
for (const [rel, archivePath] of files) {
  const current = fs.readFileSync(new URL(rel, root));
  const packaged = asar.extractFile(asarPath, archivePath);
  // Node v24 assert.deepEqual on mismatched Buffer sizes throws a misleading
  // "Array buffer allocation failed" instead of a normal assertion error.
  // Compare length first for a clear diagnostic, then content.
  if (packaged.length !== current.length) {
    assert.fail(
      `packaged ${rel} size mismatch: asar has ${packaged.length} bytes, working tree has ${current.length} bytes. ` +
      `Run "npm run dist" to rebuild the asar from current sources.`
    );
  }
  assert.deepEqual(packaged, current, `packaged ${rel} differs from the reviewed working tree`);
  console.log("  ok   packaged " + rel + " matches current build");
}

const bridge = asar.extractFile(asarPath, "dist/mobile-bridge.js").toString("utf8");
assert.doesNotMatch(bridge, /pathname\s*===\s*["']\/mobile\/auth\/pairing-code["']/,
  "packaged bridge still exposes the forbidden HTTP pairing-code route");
assert.doesNotMatch(bridge, /pathname\s*===\s*["']\/mobile\/auth\/revoke-all["']/,
  "packaged bridge still exposes HTTP revoke-all/pairing rotation");
console.log("  ok   packaged bridge contains no HTTP pairing-code or revoke-all route");

console.log("\n6 passed, 0 failed");
