#!/usr/bin/env node
// A local stand-in for the Caffeine platform's PocketIC sidecar.
//
// `test/pocketic/run-backend-lane.mjs` attaches to a "sidecar": an HTTP service
// answering GET /healthz with {"ok":true} and GET /descriptor with
// {"gatewayHost", "pocketicConfigPort"}, behind which a real PocketIC server
// listens. The lane's client (PocketIc.create) then POSTs /instances directly
// to http://<gatewayHost>:<pocketicConfigPort>.
//
// Here the caller is the Windows host (where pnpm and node_modules live) and
// the server is in a Linux container, so the descriptor names 127.0.0.1 on a
// Docker-published port and pocket-ic binds 0.0.0.0 inside the container so
// the published port reaches it.
//
// Environment:
//   POCKET_IC_BIN   path to the pocket-ic binary (found by the entrypoint)
//   POCKET_IC_PORT  port pocket-ic binds and the host reaches   (default 8091)
//   SIDECAR_PORT    wrapper port, published to the host         (default 8090)

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import net from "node:net";

const POCKET_IC_PORT = Number(process.env.POCKET_IC_PORT ?? 8091);
const SIDECAR_PORT = Number(process.env.SIDECAR_PORT ?? 8090);
const POCKET_IC_BIN = process.env.POCKET_IC_BIN ?? "pocket-ic";
// The server otherwise exits 60 seconds after its last operation (its own
// --ttl default), which reads as a broken sidecar between local runs. A week
// of idle tolerance keeps it up across a work session; `docker compose down`
// stops it explicitly.
const IDLE_TTL_SECONDS = 604_800;

if (!Number.isInteger(POCKET_IC_PORT) || !Number.isInteger(SIDECAR_PORT)) {
  console.error("sidecar: POCKET_IC_PORT and SIDECAR_PORT must be integers");
  process.exit(1);
}

function waitForPort(port, host, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port, host }, () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`sidecar: nothing answered on ${host}:${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 250);
        }
      });
    };
    attempt();
  });
}

// pocket-ic prints its banner on stdout; keep it visible for debugging.
const server = spawn(
  POCKET_IC_BIN,
  ["--ip-addr", "0.0.0.0", "--port", String(POCKET_IC_PORT), "--ttl", String(IDLE_TTL_SECONDS)],
  { stdio: ["ignore", "inherit", "inherit"] },
);
server.once("exit", (code, signal) => {
  console.error(`sidecar: pocket-ic exited (code=${code} signal=${signal}) — stopping the wrapper`);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.kill(signal);
    process.exit(0);
  });
}

await waitForPort(POCKET_IC_PORT, "127.0.0.1", 30_000);
console.log(`sidecar: pocket-ic is listening on 0.0.0.0:${POCKET_IC_PORT}`);

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${SIDECAR_PORT}`);
  if (request.method === "GET" && url.pathname === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.method === "GET" && url.pathname === "/descriptor") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ gatewayHost: "127.0.0.1", pocketicConfigPort: POCKET_IC_PORT }));
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not found" }));
}).listen(SIDECAR_PORT, "0.0.0.0", () => {
  console.log(`sidecar: wrapper on 0.0.0.0:${SIDECAR_PORT}`);
  console.log(`sidecar: point the lane at POCKETIC_SIDECAR_URL=http://127.0.0.1:${SIDECAR_PORT}`);
});
