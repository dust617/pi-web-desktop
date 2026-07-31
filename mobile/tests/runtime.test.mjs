import assert from "node:assert/strict";
import net from "node:net";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { waitForReady } = require("../../dist/pi-web-runtime.js");

let connections = 0;
const sockets = new Set();
const hanging = net.createServer((socket) => {
  connections++;
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});
await new Promise((resolve) => hanging.listen(0, "127.0.0.1", resolve));
const port = hanging.address().port;
const started = Date.now();
await assert.rejects(waitForReady(`http://127.0.0.1:${port}`, 3200), /未就绪/);
const elapsed = Date.now() - started;
assert.ok(connections <= 2, `readiness retry multiplied connections: ${connections}`);
assert.ok(elapsed < 4000, `readiness deadline overran: ${elapsed}ms`);
for (const socket of sockets) socket.destroy();
await new Promise((resolve) => hanging.close(resolve));
console.log(`  ok   readiness uses one bounded retry chain (${connections} connections, ${elapsed}ms)`);
