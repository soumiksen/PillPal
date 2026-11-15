import { Hono } from "hono";
import { EscalateBody, type EscalateResponse } from "@pillpal/shared";
import { jsonBody } from "../lib/http.js";
import { newId } from "../lib/stubs.js";

export const escalate = new Hono();

/**
 * Agent: red flag. Real flow: red alert row → iMessage caregiver → end 1:1 call →
 * group FaceTime (patient + caregiver). Never auto-calls 911.
 */
escalate.post("/", async (c) => {
  await jsonBody(c, EscalateBody);
  return c.json({ alert_id: newId(), group_call_id: `call_${newId()}` } satisfies EscalateResponse);
});
