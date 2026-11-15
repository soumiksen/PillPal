/**
 * Typed, validated environment. The only place api/ reads process.env.
 * Values come from the repo-root .env via `node --env-file=../.env` (see package.json scripts).
 * On failure we print variable NAMES only — never values.
 */
import { z } from "zod";

const optional = z.string().optional();

const EnvSchema = z.object({
  // Required for the API to boot.
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),

  // Optional for the skeleton; required later by the features that use them.
  PORT: z.coerce.number().int().positive().default(8787),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  PATIENT_ID: optional,
  PATIENT_PHONE: optional,
  CAREGIVER_PHONE: optional,
  DEMO_LANGUAGE: z.string().default("es"),
  CHERT_API_KEY: optional,
  CHERT_PROJECT_ID: optional,
  CHERT_LINE_ID: optional,
  CHERT_MSG_TOKEN: optional,
  CHERT_FROM: optional,
  CHERT_WEBHOOK_SECRET: optional,
  LIVEKIT_URL: optional,
  LIVEKIT_API_KEY: optional,
  LIVEKIT_API_SECRET: optional,
  AGENT_NAME: z.string().default("pillpal-agent"),
});

export type Env = z.infer<typeof EnvSchema>;
type EnvName = keyof Env;

/** Treat `NAME=` (empty) the same as unset. */
function rawEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && v.trim() !== "") out[k] = v;
  }
  return out;
}

function fail(missing: string[], invalid: string[]): never {
  if (missing.length) console.error(`[env] MISSING required variable(s): ${missing.join(", ")}`);
  if (invalid.length) console.error(`[env] INVALID variable(s): ${invalid.join(", ")}`);
  console.error("[env] Set them in the repo-root .env (see .env.example).");
  process.exit(1);
}

function load(): Env {
  const raw = rawEnv();
  const result = EnvSchema.safeParse(raw);
  if (result.success) return result.data;
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const issue of result.error.issues) {
    const name = String(issue.path[0]);
    (raw[name] === undefined ? missing : invalid).push(name);
  }
  fail([...new Set(missing)], [...new Set(invalid)]);
}

export const env: Env = load();

/** For scripts/features that need optional vars: exits naming any that are missing. */
export function requireEnv<K extends EnvName>(...names: K[]): { [P in K]: NonNullable<Env[P]> } {
  const missing = names.filter((n) => env[n] === undefined);
  if (missing.length) fail(missing, []);
  return Object.fromEntries(names.map((n) => [n, env[n]])) as { [P in K]: NonNullable<Env[P]> };
}
