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
  /** Devpost video patient (Shuvo), used by /video and /director (npm run video:seed prints it). */
  VIDEO_PATIENT_ID: optional,
  PATIENT_PHONE: optional,
  CAREGIVER_PHONE: optional,
  DEMO_LANGUAGE: z.string().default("es"),
  CHERT_API_KEY: optional,
  CHERT_PROJECT_ID: optional,
  CHERT_LINE_ID: optional,
  /**
   * iMessage transport.
   *  mock (default): no Chert request is ever made; sends go to an in-memory outbox and
   *    /dev/chert/* routes inject events.
   *  live: Messaging API (console.trychert.com) + SSE + signed webhook.
   *  shared: Shared-line API (app.trychert.com/api/v1/shared-messages), replies polled every 5 s;
   *    /dev/chert/* stays registered so tapbacks can be simulated.
   */
  CHERT_MODE: z.enum(["mock", "live", "shared"]).default("mock"),
  /**
   * Call path. web (default): our home-screen web apps on LiveKit + Supabase Realtime ringing.
   * facetime: the old Chert FaceTime path (CHERT_FACETIME_MODE applies).
   */
  CALL_TRANSPORT: z.enum(["web", "facetime"]).default("web"),
  /** Shared secret for the demo apps' token route and POST /demo/call-at (x-demo-code header). */
  DEMO_ACCESS_CODE: optional,
  /** FaceTime calls. mock (default): no Chert/LiveKit request. live: LiveKit room + agent dispatch + POST /v1/calls. */
  CHERT_FACETIME_MODE: z.enum(["mock", "live"]).default("mock"),
  /** Override for the FaceTime Calls API base (default https://facetime.trychert.com/api). */
  CHERT_FACETIME_BASE: z.string().url().optional(),
  /** Override for the project API base used by shared-messages (default https://app.trychert.com/api/v1). */
  CHERT_APP_BASE: z.string().url().optional(),
  /** Reminder / missed-dose scheduler (node-cron, every minute, America/Chicago). */
  SCHEDULER: z.enum(["on", "off"]).default("off"),
  /** Pending reminder with no reply after this many minutes → FaceTime dose call (once). */
  REMINDER_TIMEOUT_MIN: z.coerce.number().int().positive().default(2),
  /** Pending dose older than this many minutes → missed. */
  MISSED_AFTER_MIN: z.coerce.number().int().positive().default(60),
  /** Pharmacy for low-pill messages (optional; lat/lng enable a location pin where supported). */
  PHARMACY_NAME: optional,
  PHARMACY_ADDRESS: optional,
  PHARMACY_LAT: z.coerce.number().optional(),
  PHARMACY_LNG: z.coerce.number().optional(),
  // Messaging API (console.trychert.com/api/v1). Optional in mock, required in live.
  CHERT_MSG_TOKEN: optional,
  CHERT_FROM: optional,
  CHERT_WEBHOOK_SECRET: optional,
  /** Only for multi-tenant Chert accounts (sent as x-chert-tenant). */
  CHERT_TENANT: optional,
  LIVEKIT_URL: optional,
  LIVEKIT_API_KEY: optional,
  LIVEKIT_API_SECRET: optional,
  AGENT_NAME: z.string().default("pillpal-agent"),
}).superRefine((e, ctx) => {
  const need = (names: readonly (keyof typeof e)[], why: string) => {
    for (const name of names) {
      if (e[name] === undefined) ctx.addIssue({ code: "custom", path: [name], message: `required when ${why}` });
    }
  };
  if (e.CHERT_MODE === "live") need(["CHERT_MSG_TOKEN", "CHERT_FROM", "CHERT_WEBHOOK_SECRET"], "CHERT_MODE=live");
  if (e.CHERT_MODE === "shared") need(["CHERT_API_KEY", "CHERT_PROJECT_ID", "CHERT_LINE_ID"], "CHERT_MODE=shared");
  if (e.CALL_TRANSPORT === "web") need(["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"], "CALL_TRANSPORT=web");
  if (e.CHERT_FACETIME_MODE === "live") {
    need(
      ["CHERT_API_KEY", "CHERT_PROJECT_ID", "CHERT_LINE_ID", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"],
      "CHERT_FACETIME_MODE=live",
    );
  }
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
