import { Hono } from "hono";
import { EscalateBody, type EscalateResponse } from "@pillpal/shared";
import { jsonBody } from "../lib/http.js";
import { escalate as escalatePatient } from "../services/escalate.js";

export const escalate = new Hono();

/**
 * Agent: red flag → red alert row + iMessage to the caregiver (services/escalate.ts).
 * TODO(next PR): end the 1:1 call and start a group FaceTime (patient + caregiver).
 * Never auto-calls 911.
 */
escalate.post("/", async (c) => {
  const body = await jsonBody(c, EscalateBody);
  const r = await escalatePatient(body);
  return c.json({ alert_id: r.alert_id, group_call_id: r.group_call_id } satisfies EscalateResponse);
});
