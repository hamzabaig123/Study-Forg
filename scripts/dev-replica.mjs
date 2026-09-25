#!/usr/bin/env node
// Local dev replica wiring: creates a PocketIC instance, installs the backend
// canister, exposes its HTTP gateway, and points src/frontend/env.json at it.
//
// Requires a running PocketIC server (see README note in this file's usage):
//   wsl -d pocketic -- /mnt/c/Users/hamza/AppData/Local/studyforge-replica/pocket-ic
// Then: node scripts/dev-replica.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PIC_SERVER_URL = process.env.POCKET_IC_URL ?? "http://localhost:8080";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = path.join(root, "src", "backend", "dist", "backend.wasm");
const envPath = path.join(root, "src", "frontend", "env.json");

const { PocketIc } = await import("@dfinity/pic");
const { idlFactory } = await import("../src/frontend/src/declarations/backend.did.js");

const pic = await PocketIc.create(PIC_SERVER_URL);
const { canisterId } = await pic.setupCanister({ idlFactory, wasm: wasmPath });
const gatewayPort = await pic.makeLive();

writeFileSync(envPath, `${JSON.stringify({
  backend_host: `http://localhost:${gatewayPort}`,
  backend_canister_id: canisterId.toText(),
  project_id: "undefined",
  ii_derivation_origin: "undefined",
  storage_gateway_url: "undefined",
}, null, 2)}\n`);

console.log(`PocketIC server:    ${PIC_SERVER_URL}`);
console.log(`Canister installed: ${canisterId.toText()}`);
console.log(`HTTP gateway:       http://localhost:${gatewayPort}`);
console.log(`Wrote ${path.relative(root, envPath)} — reload the app to connect.`);
console.log("Keep this process running; the instance dies with it.");
