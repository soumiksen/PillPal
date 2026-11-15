#!/usr/bin/env node
// npm run demo:up — the laptop side of the phone demo, in one terminal:
//   [api] PillPal API on :8787 with CALL_TRANSPORT=web (SCHEDULER=off; demo:up:sched rings at dose times)
//   [pal] the LiveKit agent worker (Pal), registered with LiveKit Cloud
// Both read the repo-root .env. Ctrl+C stops both. Values from .env are never printed.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(join(root, ".env"))) {
  console.error("demo:up needs the repo-root .env (see .env.example).");
  process.exit(1);
}

// Scheduler is OFF unless you run `npm run demo:up:sched` (or pass --sched). A value set in your shell wins
// (e.g. `CHERT_MODE=mock npm run demo:up` for a dry run that sends no iMessages).
const sched = process.argv.includes("--sched");
const overrides = {
  CALL_TRANSPORT: process.env.CALL_TRANSPORT ?? "web",
  SCHEDULER: process.env.SCHEDULER ?? (sched ? "on" : "off"),
  FORCE_COLOR: "1",
};
const procs = [
  {
    name: "api",
    color: "\x1b[36m",
    cwd: join(root, "api"),
    args: ["--env-file=../.env", "--import", "tsx", "src/index.ts"],
  },
  {
    name: "pal",
    color: "\x1b[35m",
    cwd: join(root, "agent"),
    args: ["--env-file=../.env", "--import", "tsx", "src/agent.ts", "dev", "--log-level", "info"],
  },
];

const children = [];
let stopping = false;
for (const p of procs) {
  const child = spawn(process.execPath, p.args, { cwd: p.cwd, env: { ...process.env, ...overrides }, stdio: ["ignore", "pipe", "pipe"] });
  const tag = `${p.color}[${p.name}]\x1b[0m `;
  let carry = { out: "", err: "" };
  const pipe = (stream, key, sink) =>
    stream.on("data", (buf) => {
      const lines = (carry[key] + buf.toString()).split("\n");
      carry[key] = lines.pop() ?? "";
      for (const line of lines) sink.write(tag + line + "\n");
    });
  pipe(child.stdout, "out", process.stdout);
  pipe(child.stderr, "err", process.stderr);
  child.on("exit", (code, signal) => {
    process.stdout.write(`${tag}exited (${signal ?? code})\n`);
    if (!stopping) shutdown(code ?? 1);
  });
  children.push(child);
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  setTimeout(() => {
    for (const c of children) if (c.exitCode === null) c.kill("SIGKILL");
    process.exit(code);
  }, 4000).unref();
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
console.log(`demo:up → [api] CALL_TRANSPORT=${overrides.CALL_TRANSPORT} SCHEDULER=${overrides.SCHEDULER} · [pal] agent worker. Ctrl+C stops both.`);
