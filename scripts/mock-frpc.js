#!/usr/bin/env node
/**
 * Mock frpc - 用于测试的 frpc 模拟器
 * 
 * 行为：
 * - 读取配置文件（TOML）
 * - 模拟启动日志
 * - 根据环境变量模拟成功/失败场景
 * - 支持 SIGTERM 优雅退出
 */

const fs = require("fs");
const path = require("path");

const configPath = process.argv[2] || process.env.MOCK_FRPC_CONFIG;
const scenario = process.env.MOCK_FRPC_SCENARIO || "success";
const delayMs = parseInt(process.env.MOCK_FRPC_DELAY || "500", 10);

console.log(`[mock-frpc] Starting with scenario: ${scenario}`);

if (!configPath) {
  console.error("[mock-frpc] No config file specified");
  process.exit(1);
}

if (!fs.existsSync(configPath)) {
  console.error(`[mock-frpc] Config file not found: ${configPath}`);
  process.exit(1);
}

// Simulate startup delay
setTimeout(() => {
  switch (scenario) {
    case "success":
      console.log("[mock-frpc] Loading configuration...");
      console.log(`[mock-frpc] Config file: ${configPath}`);
      console.log("[mock-frpc] login to server success");
      console.log("[mock-frpc] start proxy success");
      console.log("[mock-frpc] Proxy is ready");
      break;

    case "fragmented_success":
      // Split the readiness markers over separate stdout chunks, mirroring
      // real process pipes where a write boundary is not a line boundary.
      process.stdout.write("[mock-frpc] login to ");
      setTimeout(() => {
        process.stdout.write("server success\n[mock-frpc] start proxy ");
        setTimeout(() => process.stdout.write("success\n"), 10);
      }, 10);
      break;

    case "auth_failed":
      console.log("[mock-frpc] Loading configuration...");
      console.log("[mock-frpc] login to server failed: authorization failed");
      process.exit(1);
      break;

    case "proxy_conflict":
      console.log("[mock-frpc] Loading configuration...");
      console.log("[mock-frpc] login to server success");
      console.log("[mock-frpc] start proxy failed: remote port is already used");
      process.exit(1);
      break;

    case "config_error":
      console.log("[mock-frpc] Loading configuration...");
      console.error("[mock-frpc] invalid config: parse error");
      process.exit(1);
      break;

    case "network_error":
      console.log("[mock-frpc] Loading configuration...");
      console.log("[mock-frpc] connecting to server...");
      console.error("[mock-frpc] connection refused");
      process.exit(1);
      break;

    case "slow_start":
      console.log("[mock-frpc] Loading configuration...");
      setTimeout(() => {
        console.log("[mock-frpc] login to server success");
        console.log("[mock-frpc] start proxy success");
      }, 5000);
      break;

    case "hang":
      console.log("[mock-frpc] Loading configuration...");
      // Never become ready
      break;

    default:
      console.error(`[mock-frpc] Unknown scenario: ${scenario}`);
      process.exit(1);
  }
}, delayMs);

// Handle graceful shutdown
process.on("SIGTERM", () => {
  console.log("[mock-frpc] Received SIGTERM, shutting down...");
  setTimeout(() => {
    console.log("[mock-frpc] Goodbye");
    process.exit(0);
  }, 100);
});

process.on("SIGINT", () => {
  console.log("[mock-frpc] Received SIGINT, shutting down...");
  process.exit(0);
});

// Keep process alive
setInterval(() => {
  // Heartbeat
}, 1000);
