/**
 * One read-only request to check the iMessage credentials. Never prints phone numbers, bodies or tokens.
 *   live:   GET console.trychert.com/api/v1/phone-numbers → line id + capabilities
 *   shared: GET app.trychert.com/api/v1/shared-messages   → HTTP status + response field NAMES
 *   mock:   no request
 *
 *   npm run chert:ping   (from api/)
 */
import { chertJson } from "../src/chert/http.js";
import { APP_BASE, ChertApiError, fieldNames, projectFetch } from "../src/chert/project-http.js";
import type { PhoneLine } from "../src/chert/types.js";
import { env } from "../src/env.js";

if (env.CHERT_MODE === "mock") {
  console.log("mock mode, skipping");
  process.exit(0);
}

if (env.CHERT_MODE === "shared") {
  try {
    const res = await projectFetch({ base: APP_BASE, method: "GET", path: "/shared-messages" });
    const json: unknown = await res.json().catch(() => undefined);
    console.log(`shared: GET /shared-messages → ${res.status}`);
    console.log(`fields: ${fieldNames(json)}`);
    const list = Array.isArray(json) ? json : ((json as { data?: unknown })?.data ?? (json as { messages?: unknown })?.messages);
    if (Array.isArray(list)) console.log(`messages: ${list.length}`);
  } catch (err) {
    console.log(err instanceof ChertApiError ? `shared: → ${err.status} ${err.code ?? ""}` : `shared: ${(err as Error).message}`);
    process.exit(1);
  }
  process.exit(0);
}

const { phone_numbers } = await chertJson<{ phone_numbers: PhoneLine[] }>("GET", "/phone-numbers");
if (phone_numbers.length === 0) console.log("no phone lines on this token");
for (const line of phone_numbers) {
  const caps = line.capabilities.length ? line.capabilities.join(", ") : "(none)";
  console.log(`line ${line.phone_line_id ?? line.id}${line.is_active ? "" : " (inactive)"}: ${caps}`);
}
