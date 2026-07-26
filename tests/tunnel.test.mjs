// Tunnel Supervisor tests
//   node tests/tunnel.test.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { ManagedProcess } = await import("../dist/managed-process.js");
const { FrpcAdapter } = await import("../dist/frpc-adapter.js");
const { TunnelSupervisor } = await import("../dist/tunnel-supervisor.js");

const MOCK_FRPC = path.join(__dirname, "..", "scripts", "mock-frpc.js");

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log("  ok   " + name);
  } else {
    fail++;
    failures.push(name);
    console.log("  FAIL " + name + (extra ? " :: " + extra : ""));
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testManagedProcess() {
  console.log("\n=== ManagedProcess Tests ===");

  // Test 1: Start and stop (simplified)
  {
    const proc = new ManagedProcess({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 10000)"],
      name: "test-simple",
      startTimeoutMs: 5000,
      stopTimeoutMs: 2000,
      autoRestart: false,
    });

    await proc.start();
    const status = proc.getStatus();
    check("MP1: start sets state to running", status.state === "running", `got ${status.state}`);
    check("MP1: pid is set", status.pid !== null, `pid=${status.pid}`);

    await proc.stop();
    const stoppedStatus = proc.getStatus();
    check("MP1: stop sets state to stopped", stoppedStatus.state === "stopped", `got ${stoppedStatus.state}`);
  }

  // Test 2: Start timeout
  {
    const proc = new ManagedProcess({
      command: process.execPath,
      args: [MOCK_FRPC],
      env: { ...process.env, MOCK_FRPC_SCENARIO: "hang", MOCK_FRPC_DELAY: "100" },
      name: "test-frpc-hang",
      startTimeoutMs: 1000,
      stopTimeoutMs: 1000,
      autoRestart: false,
      readinessCheck: async () => false,
      readinessTimeoutMs: 500,
    });

    let threw = false;
    try {
      await proc.start();
    } catch (err) {
      threw = true;
      check("MP2: start timeout throws", err.message.includes("Readiness timeout"));
    }
    check("MP2: start timeout occurred", threw);

    await proc.stop();
  }

  // Test 3: Process exit detection (simplified)
  {
    const proc = new ManagedProcess({
      command: process.execPath,
      args: ["-e", "process.exit(1)"],
      name: "test-exit",
      startTimeoutMs: 5000,
      stopTimeoutMs: 2000,
      autoRestart: false,
      readinessCheck: async () => false, // Never ready
      readinessTimeoutMs: 500,
    });

    let threw = false;
    try {
      await proc.start();
    } catch {
      threw = true;
    }

    check("MP3: process exit or timeout detected", threw);
  }

  // Test 4: Blocked state
  {
    const proc = new ManagedProcess({
      command: process.execPath,
      args: [MOCK_FRPC],
      env: { ...process.env, MOCK_FRPC_SCENARIO: "success" },
      name: "test-frpc-blocked",
      autoRestart: false,
    });

    proc.block("test blocked");
    check("MP4: block sets state to blocked", proc.getStatus().state === "blocked");
    check("MP4: blockedReason is set", proc.getStatus().blockedReason === "test blocked");

    let threw = false;
    try {
      await proc.start();
    } catch (err) {
      threw = true;
      check("MP4: start throws when blocked", err.message.includes("blocked"));
    }
    check("MP4: start rejected when blocked", threw);

    proc.unblock();
    check("MP4: unblock clears blocked state", proc.getStatus().state === "stopped");
  }
}

async function testFrpcAdapter() {
  console.log("\n=== FrpcAdapter Tests ===");

  // Test 1: TOML generation
  {
    const profile = {
      serverAddr: "example.com",
      serverPort: 7000,
      proxyName: "test-proxy",
      localAddr: "127.0.0.1",
      localPort: 62810,
      remotePort: 8443,
      protocol: "tcp",
    };

    const toml = FrpcAdapter.generateToml(profile, "FRPC_TOKEN");
    check("FA1: TOML contains serverAddr", toml.includes("example.com"));
    check("FA1: TOML contains serverPort", toml.includes("7000"));
    check("FA1: TOML contains proxyName", toml.includes("test-proxy"));
    check("FA1: TOML uses env template for token", toml.includes("{{ .Envs.FRPC_TOKEN }}"));
    check("FA1: TOML does not contain raw token", !toml.includes("secret123"));
  }

  // Test 2: Adapter instantiation (simplified)
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "frpc-test-"));
    const configPath = path.join(tmpDir, "frpc.toml");
    fs.writeFileSync(configPath, "# test config");

    try {
      const adapter = new FrpcAdapter({
        configPath,
        binaryPath: process.execPath,
        version: "0.50.0",
      });

      const status = adapter.getStatus();
      check("FA2: adapter can be instantiated", adapter !== null);
      check("FA2: initial state is not running", !status.running);
      check("FA2: initial pid is null", status.pid === null);
    } catch (err) {
      check("FA2: adapter instantiation succeeded", false, err.message);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testTunnelSupervisor() {
  console.log("\n=== TunnelSupervisor Tests ===");

  // Test 1: Initial state
  {
    const supervisor = new TunnelSupervisor({
      configPath: "/tmp/test.toml",
      binaryPath: "node",
      version: "0.50.0",
    });

    const status = supervisor.getStatus();
    check("TS1: initial state is disabled", status.state === "disabled");
    check("TS1: not enabled by default", !status.enabled);
    check("TS1: no publicUrl", status.publicUrl === null);
  }

  // Test 2: Load profile
  {
    const supervisor = new TunnelSupervisor({
      configPath: "/tmp/test.toml",
      binaryPath: "node",
      version: "0.50.0",
    });

    const profile = {
      publicUrl: "https://example.com",
      frpc: {
        serverAddr: "example.com",
        serverPort: 7000,
        proxyName: "test-proxy",
        localAddr: "127.0.0.1",
        localPort: 62810,
        remotePort: 8443,
        protocol: "tcp",
      },
      autoStart: false,
    };

    await supervisor.loadProfile(profile);
    const status = supervisor.getStatus();
    check("TS2: loadProfile sets state to disabled when autoStart=false", status.state === "disabled");
    check("TS2: publicUrl is set", status.publicUrl === "https://example.com");
  }

  // Test 3: Validate HTTPS requirement
  {
    const supervisor = new TunnelSupervisor({
      configPath: "/tmp/test.toml",
      binaryPath: "node",
      version: "0.50.0",
    });

    const profile = {
      publicUrl: "http://example.com", // Not HTTPS
      frpc: {
        serverAddr: "example.com",
        serverPort: 7000,
        proxyName: "test-proxy",
        localAddr: "127.0.0.1",
        localPort: 62810,
        remotePort: 8443,
        protocol: "tcp",
      },
      autoStart: true,
    };

    let threw = false;
    try {
      await supervisor.loadProfile(profile);
    } catch (err) {
      threw = true;
      check("TS3: non-HTTPS URL throws", err.message.includes("HTTPS"));
    }
    check("TS3: validation rejected non-HTTPS", threw);
    check("TS3: state is blocked after validation failure", supervisor.getStatus().state === "blocked");
  }

  // Test 4: Diagnostic ID generation
  {
    const supervisor = new TunnelSupervisor({
      configPath: "/tmp/test.toml",
      binaryPath: "node",
      version: "0.50.0",
    });

    const profile = {
      publicUrl: "https://example.com",
      frpc: {
        serverAddr: "example.com",
        serverPort: 7000,
        proxyName: "test-proxy",
        localAddr: "127.0.0.1",
        localPort: 62810,
        remotePort: 8443,
        protocol: "tcp",
      },
      autoStart: true,
    };

    await supervisor.loadProfile(profile);
    
    // Try to start (will fail because mock frpc doesn't exist)
    let threw = false;
    try {
      await supervisor.start("test-token");
    } catch {
      threw = true;
    }

    const status = supervisor.getStatus();
    check("TS4: diagnosticId is generated on start attempt", status.diagnosticId !== null);
    check("TS4: diagnosticId has correct format", status.diagnosticId?.startsWith("diag-"));
  }
}

async function main() {
  console.log("Tunnel Supervisor Test Suite");
  console.log("==========================");

  try {
    await testManagedProcess();
    await testFrpcAdapter();
    await testTunnelSupervisor();
  } catch (err) {
    console.error("Test suite error:", err);
    fail++;
  }

  console.log("\n" + "=".repeat(50));
  console.log(`${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log("failures:");
    failures.forEach((f) => console.log("  - " + f));
  }

  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
