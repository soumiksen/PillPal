/**
 * One read-only FaceTime request: GET {FACETIME_BASE}/v1/lines → HTTP status + field names, and whether
 * CHERT_LINE_ID is among the listed line ids. Never prints keys, tokens or phone numbers.
 * Skipped when CHERT_FACETIME_MODE=mock.
 *
 *   npm run facetime:ping   (from api/)
 */
import { ChertApiError, FACETIME_BASE, fieldNames, projectFetch } from "../src/chert/project-http.js";
import { env } from "../src/env.js";

if (env.CHERT_FACETIME_MODE !== "live") {
  console.log("facetime mock mode, skipping");
  process.exit(0);
}

try {
  const res = await projectFetch({ base: FACETIME_BASE, method: "GET", path: "/v1/lines" });
  const json = (await res.json().catch(() => undefined)) as { data?: unknown; lines?: unknown } | undefined;
  console.log(`facetime: GET /v1/lines → ${res.status}`);
  console.log(`fields: ${fieldNames(json)}`);
  const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.lines) ? json.lines : [];
  const ids = (list as { id?: string }[]).map((l) => l.id);
  console.log(`lines: ${list.length}; CHERT_LINE_ID ${ids.includes(env.CHERT_LINE_ID) ? "found" : "NOT found"}`);
} catch (err) {
  console.log(err instanceof ChertApiError ? `facetime: → ${err.status} ${err.code ?? ""}` : `facetime: ${(err as Error).message}`);
  process.exit(1);
}
