/** One-command local call test. Keys arrive via Node's ignored .env.avatar-test file. */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { avatarCallEnvironment } from "./avatar-call-config.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const children = new Set<ChildProcess>();
const abort = new AbortController();
let stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  abort.abort();
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  const timer = setTimeout(() => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 5000);
  timer.unref();
}

function launch(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
  children.add(child);
  child.once("error", () => { console.error("[avatar-test] A local test process could not start"); void stop(1); });
  child.once("exit", () => {
    children.delete(child);
    if (!stopping) { console.error("[avatar-test] A test process stopped; closing the other process"); void stop(1); }
  });
  return child;
}

async function waitReady(url: string) {
  const deadline = Date.now() + 45000;
  while (!stopping && Date.now() < deadline) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1500) })).ok) return; } catch { /* retry */ }
    await delay(300, undefined, { signal: abort.signal });
  }
  throw new Error("Test startup timed out. Check that LiveKit is reachable and the configured ports are free.");
}

process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });

try {
  if (process.platform === "win32" && process.arch === "arm64") {
    throw new Error("This LiveKit SDK has no native Windows ARM64 binary. Run the worker in WSL2/Linux; Chrome can stay on Windows.");
  }
  const env = avatarCallEnvironment(process.env, `pillpal-avatar-test-${randomUUID().slice(0, 8)}`);
  // Build only the shared libraries needed by the agent, without a frontend build.
  const compiler = spawn(process.execPath, ["node_modules/typescript/bin/tsc", "-b", "packages/shared", "packages/ai"], { cwd: root, env, stdio: "inherit" });
  children.add(compiler);
  const built = await new Promise<number | null>((resolve, reject) => {
    compiler.once("error", reject);
    compiler.once("exit", code => { children.delete(compiler); resolve(code); });
  });
  if (built !== 0) throw new Error("Shared library build failed");
  if (!stopping) {
    launch(["--import", "tsx", "agent/dev/local.ts"], env);
    await waitReady(`${env.API_URL}/`);
    launch(["--import", "tsx", "agent/src/agent.ts", "dev", "--log-level", "warn"], env);
    await waitReady(`http://127.0.0.1:${env.AGENT_PORT}/`);
    console.log(`[avatar-test] Ready: open http://localhost:${env.LOCAL_PORT}`);
    console.log("[avatar-test] Pick a companion and start a call. Fictional patient; caregiver alerts are simulated. Ctrl+C stops the test.");
    if (!env.ANTHROPIC_API_KEY) console.log("[avatar-test] Vision uses the existing offline stubs; add ANTHROPIC_API_KEY for real camera analysis.");
  }
} catch (error) {
  if (!stopping) console.error(`[avatar-test] ${error instanceof Error ? error.message : "Test startup failed"}`);
  await stop(stopping ? 0 : 1);
}
