// Runs a command with the repo-root .env loaded (values are never printed).
// Also maps PATIENT_ID → NEXT_PUBLIC_PATIENT_ID for the phone apps' default.
// Usage (from web/): node scripts/with-root-env.mjs next dev -p 3000
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync("../.env")) process.loadEnvFile("../.env");
process.env.NEXT_PUBLIC_PATIENT_ID ||= process.env.PATIENT_ID ?? "";
const [cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
