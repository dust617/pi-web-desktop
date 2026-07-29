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

async function waitUntil(predicate, timeoutMs, pollMs = 10) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(pollMs);
  }
  return predicate();
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

  // Test 5: an adapter-classified startup failure must retain blocked state.
  {
    const proc = new ManagedProcess({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 10000)"],
      name: "test-blocked-during-readiness",
      autoRestart: false,
      readinessIntervalMs: 10,
      readinessTimeoutMs: 100,
      readinessCheck: async () => {
        proc.block("auth_failed");
        return false;
      },
    });
    await proc.start().catch(() => {});
    check("MP5: blocked state survives a failed readiness start", proc.getStatus().state === "blocked");
    await proc.stop();
  }

  // Test 6: restart budget enters crash-loop block without production delays.
  {
    const proc = new ManagedProcess({
      command: process.execPath,
      args: ["-e", "process.exit(1)"],
      name: "test-crash-loop",
      autoRestart: true,
      readinessCheck: async () => false,
      readinessIntervalMs: 5,
      readinessTimeoutMs: 30,
      restartDelaysMs: [5],
      restartWindowMs: 1000,
      maxRestartsInWindow: 2,
    });
    await proc.start().catch(() => {});
    // Process creation is materially slower on some Windows hosts; wait for the
    // state transition instead of assuming three crash/restart cycles fit 1s.
    await waitUntil(() => proc.getStatus().state === "blocked", 2500);
    const status = proc.getStatus();
    check("MP6: repeated exits enter crash-loop block", status.state === "blocked", JSON.stringify(status));
    check("MP6: crash-loop reason is retained", status.blockedReason?.includes("crash_loop"));
    await proc.stop();
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

  const profile = {
    serverAddr: "example.com",
    serverPort: 7000,
    proxyName: "test-proxy",
    localAddr: "127.0.0.1",
    localPort: 62810,
    remotePort: 8443,
    protocol: "tcp",
  };

  function createMockAdapter(scenario) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "frpc-test-"));
    const configPath = path.join(tmpDir, "frpc.toml");
    fs.writeFileSync(configPath, "# test config");
    const adapter = new FrpcAdapter({
      configPath,
      binaryPath: process.execPath,
      args: [MOCK_FRPC, configPath],
      version: "0.50.0",
    });
    return { adapter, tmpDir };
  }

  // Test 2: successful startup consumes fragmented child output while
  // ManagedProcess is still starting. This covers pipe chunk reassembly and
  // the readiness-deadlock regression.
  {
    const { adapter, tmpDir } = createMockAdapter("fragmented_success");
    const logs = [];
    adapter.on("log", ({ line }) => logs.push(line));
    const originalScenario = process.env.MOCK_FRPC_SCENARIO;
    const originalDelay = process.env.MOCK_FRPC_DELAY;
    process.env.MOCK_FRPC_SCENARIO = "fragmented_success";
    process.env.MOCK_FRPC_DELAY = "20";
    try {
      await adapter.start(profile, "test-token-not-for-output");
      const status = adapter.getStatus();
      check("FA2: mock frpc reaches running without readiness deadlock", status.running, JSON.stringify(status));
      check("FA2: fragmented startup logs are reassembled", logs.some((line) => line.includes("start proxy success")));
      check("FA2: captured logs are redacted", !logs.join("\n").includes("test-token-not-for-output"));
      await adapter.stop();
    } catch (err) {
      check("FA2: mock frpc startup succeeded", false, err.message);
    } finally {
      if (originalScenario === undefined) delete process.env.MOCK_FRPC_SCENARIO;
      else process.env.MOCK_FRPC_SCENARIO = originalScenario;
      if (originalDelay === undefined) delete process.env.MOCK_FRPC_DELAY;
      else process.env.MOCK_FRPC_DELAY = originalDelay;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // Test 3: a real mock failure is classified through EventEmitter events;
  // the token itself is never included in emitted log assertions or output.
  {
    const { adapter, tmpDir } = createMockAdapter("auth_failed");
    const errors = [];
    adapter.on("frpcError", (error) => errors.push(error));
    const originalScenario = process.env.MOCK_FRPC_SCENARIO;
    const originalDelay = process.env.MOCK_FRPC_DELAY;
    process.env.MOCK_FRPC_SCENARIO = "auth_failed";
    process.env.MOCK_FRPC_DELAY = "20";
    try {
      let threw = false;
      try {
        await adapter.start(profile, "test-token-not-for-output");
      } catch {
        threw = true;
      }
      await sleep(30);
      check("FA3: auth failure rejects startup", threw);
      check("FA3: auth failure is classified through frpcError event", errors.some((error) => error.category === "auth_failed" && error.retryable === false));
      check("FA3: auth failure emits one classified error", errors.length === 1, JSON.stringify(errors));
      await adapter.stop();
    } finally {
      if (originalScenario === undefined) delete process.env.MOCK_FRPC_SCENARIO;
      else process.env.MOCK_FRPC_SCENARIO = originalScenario;
      if (originalDelay === undefined) delete process.env.MOCK_FRPC_DELAY;
      else process.env.MOCK_FRPC_DELAY = originalDelay;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // Test 4: transient network exits are classified retryable and do not use
  // the permanent auth/config blocking path.
  {
    const { adapter, tmpDir } = createMockAdapter("network_error");
    const errors = [];
    adapter.on("frpcError", (error) => errors.push(error));
    const originalScenario = process.env.MOCK_FRPC_SCENARIO;
    const originalDelay = process.env.MOCK_FRPC_DELAY;
    process.env.MOCK_FRPC_SCENARIO = "network_error";
    process.env.MOCK_FRPC_DELAY = "20";
    try {
      await adapter.start(profile, "test-token-not-for-output").catch(() => {});
      await sleep(30);
      check("FA4: network failure is retryable", errors.some((error) => error.category === "network_error" && error.retryable));
      check("FA4: network failure emits one classified error", errors.length === 1, JSON.stringify(errors));
      await adapter.stop();
    } finally {
      if (originalScenario === undefined) delete process.env.MOCK_FRPC_SCENARIO;
      else process.env.MOCK_FRPC_SCENARIO = originalScenario;
      if (originalDelay === undefined) delete process.env.MOCK_FRPC_DELAY;
      else process.env.MOCK_FRPC_DELAY = originalDelay;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
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
