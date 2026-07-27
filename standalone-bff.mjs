// Standalone MobileBridge BFF — attaches to the EXISTING pi-web runtime on 62809
// so we do NOT spawn a second runtime and do NOT disturb the live Electron session.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { MobileBridge, resolveAllowedOrigins } = require("./dist/mobile-bridge.js");

const PI_WEB_URL = process.env.PI_WEB_URL || "http://127.0.0.1:62809";
const PORT = Number(process.env.MOBILE_BRIDGE_PORT || 62810);

// Duck-typed runtime: BFF only reads runtime.info.{url,port}. We attach to the
// EXISTING pi-web runtime so we never spawn a second one or disturb the session.
const fakeRuntime = {
  get info() {
    return { port: Number(new URL(PI_WEB_URL).port), url: PI_WEB_URL, pid: -1 };
  },
  get isRunning() {
    return true;
  },
};

// Single source of truth shared with the Electron integration (P0-2).
const allowedOrigins = resolveAllowedOrigins();

const BIND = process.env.BFF_BIND || "127.0.0.1";

const bridge = new MobileBridge({
  runtime: fakeRuntime,
  port: PORT,
  bindHost: BIND,
  allowedOrigins,
  sessionStorePath: path.join(path.dirname(fileURLToPath(import.meta.url)), "bff-sessions.json"),
});

console.log("[standalone-bff] *** DEV-ONLY standalone BFF (not the packaged Electron path) ***");
console.log("[standalone-bff] pi-web upstream:", PI_WEB_URL);
console.log("[standalone-bff] allowed origins:", allowedOrigins.length ? allowedOrigins.join(", ") : "(none -> loopback-only mode)");

bridge
  .start()
  .then((port) => {
    const code = bridge.pairingCode;
    console.log(`[standalone-bff] listening on ${BIND}:${port}`);
    writeFileSync(
      "D:/PI-web-desktop/bff-pairing-code.txt",
      `port=${port}\ncode=${code}\nurl=https://pi.example.test:8443/mobile/\n`
    );
  })
  .catch((err) => {
    console.error("[standalone-bff] start failed:", err.message);
    if (/EADDRINUSE|already in use/i.test(err.message)) {
      console.error(
        `[standalone-bff] port ${PORT} is already in use. Another standalone BFF or the integrated ` +
        `Electron MobileBridge may be running. Stop it first, or set MOBILE_BRIDGE_PORT to a free port ` +
        `(and update the cloudflared tunnel ingress to match).`
      );
    }
    process.exit(1);
  });

// Keep alive; graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    console.log(`[standalone-bff] ${sig} received, stopping`);
    try {
      await bridge.stop();
    } catch {}
    process.exit(0);
  });
}
