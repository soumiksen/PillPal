#!/usr/bin/env node
// npm run video:up — Devpost video mode on the laptop, in one terminal:
//   [api] PillPal API on :8787, CALL_TRANSPORT=web, SCHEDULER=off (always), PATIENT_ID=VIDEO_PATIENT_ID
//   [pal] the agent worker with PAL_MODE=script (pre-recorded lines, no LLM)
// Director page: http://localhost:8787/director  ·  or npm run scene:1 / scene:2 / scene:reset
// The worker registers as AGENT_NAME=pillpal-video (not pillpal-agent), so a live Pal worker that is still
// running somewhere can never pick up a scripted call. Values from .env are never printed.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env");
if (!existsSync(envFile)) {
  console.error("video:up needs the repo-root .env (see .env.example).");
  process.exit(1);
}
const fromFile = {};
{
  const before = { ...process.env };
  process.loadEnvFile(envFile);
  for (const k of ["VIDEO_PATIENT_ID", "DEMO_ACCESS_CODE"]) fromFile[k] = process.env[k];
  for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k];
}
const videoPatient = process.env.VIDEO_PATIENT_ID || fromFile.VIDEO_PATIENT_ID;
if (!videoPatient) {
  console.error("VIDEO_PATIENT_ID is not set. Run `npm run video:seed` and put the id it prints in .env as VIDEO_PATIENT_ID=…");
  process.exit(1);
}
if (!(process.env.DEMO_ACCESS_CODE || fromFile.DEMO_ACCESS_CODE)) console.warn("warning: DEMO_ACCESS_CODE is not set; the director page and scenes will refuse.");

// A value set in your shell wins (PORT, API_URL, AGENT_NAME, CHERT_MODE), except SCHEDULER, which stays off.
const overrides = {
  CALL_TRANSPORT: "web",
  SCHEDULER: "off",
  PAL_MODE: "script",
  VIDEO_PATIENT_ID: videoPatient,
  PATIENT_ID: videoPatient,
  AGENT_NAME: process.env.AGENT_NAME ?? "pillpal-video",
  FORCE_COLOR: "1",
};
const procs = [
  { name: "api", color: "\x1b[36m", cwd: join(root, "api"), args: ["--env-file=../.env", "--import", "tsx", "src/index.ts"] },
  { name: "pal", color: "\x1b[35m", cwd: join(root, "agent"), args: ["--env-file=../.env", "--import", "tsx", "src/agent.ts", "dev", "--log-level", "info"] },
];

const children = [];
let stopping = false;
for (const p of procs) {
  const child = spawn(process.execPath, p.args, { cwd: p.cwd, env: { ...process.env, ...overrides }, stdio: ["ignore", "pipe", "pipe"] });
  const tag = `${p.color}[${p.name}]\x1b[0m `;
  const carry = { out: "", err: "" };
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
const port = process.env.PORT ?? "8787";
console.log(
  `video:up → [api] :${port} CALL_TRANSPORT=web SCHEDULER=off · [pal] PAL_MODE=script AGENT_NAME=${overrides.AGENT_NAME}. ` +
    `Director: http://localhost:${port}/director · Ctrl+C stops both.`,
);
