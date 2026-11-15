#!/usr/bin/env node
// npm run scene:1 | scene:2 | scene:reset — trigger the Devpost video scenes on the running `npm run video:up`.
// Uses DEMO_ACCESS_CODE and API_URL from the repo-root .env (shell values win). Never prints the code.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const what = process.argv[2];
const path = { 1: "/video/scene/1", 2: "/video/scene/2", reset: "/video/reset" }[what];
if (!path) {
  console.error("usage: node scripts/scene.mjs 1|2|reset");
  process.exit(2);
}
const base = (process.env.VIDEO_API ?? process.env.API_URL ?? "http://localhost:8787").replace(/\/$/, "");
try {
  const r = await fetch(base + path, { method: "POST", headers: { "x-demo-code": process.env.DEMO_ACCESS_CODE ?? "" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`✗ ${what}: ${j.error ?? j.message ?? `HTTP ${r.status}`}`);
    process.exit(1);
  }
  console.log(`✓ ${what === "reset" ? "reset" : `scene ${what} ringing`} ${JSON.stringify(j)}`);
} catch (err) {
  console.error(`✗ ${what}: is npm run video:up running? (${err.message})`);
  process.exit(1);
}
