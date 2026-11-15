/** Test env (set before any src/ import; src/env.ts reads process.env at import). No .env is loaded. */
Object.assign(process.env, {
  SUPABASE_URL: "http://127.0.0.1:9",
  SUPABASE_SERVICE_KEY: "test-service-key",
  CHERT_MODE: "shared",
  CHERT_FACETIME_MODE: "mock",
  CHERT_API_KEY: "ftk_test",
  CHERT_PROJECT_ID: "11111111-1111-4111-8111-111111111111",
  CHERT_LINE_ID: "22222222-2222-4222-8222-222222222222",
  LIVEKIT_URL: "wss://test.livekit.cloud",
  LIVEKIT_API_KEY: "APItest",
  LIVEKIT_API_SECRET: "secret-secret-secret-secret-secret-secret",
  PATIENT_PHONE: "+15550000001",
  CAREGIVER_PHONE: "+15550000002",
  ANTHROPIC_API_KEY: "",
  GOOGLE_API_KEY: "",
});
for (const k of ["CHERT_APP_BASE", "CHERT_FACETIME_BASE"]) delete process.env[k];

export type Captured = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** Replace global fetch; every request is captured and answered by `reply`. */
export function stubFetch(reply: (req: Captured) => { status?: number; json: unknown }): Captured[] {
  const seen: Captured[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const req: Captured = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    seen.push(req);
    const r = reply(req);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return seen;
}
