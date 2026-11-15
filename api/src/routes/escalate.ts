import { Hono } from "hono";
import { EscalateBody, type EscalateResponse } from "@pillpal/shared";
import { jsonBody } from "../lib/http.js";
import { escalate as escalatePatient } from "../services/escalate.js";

export const escalate = new Hono();

/**
 * Agent: red flag → red alert + caregiver iMessage (awaited), then asynchronously end the 1:1 call and
 * ring patient + caregiver on group FaceTime, or text the caregiver "Please FaceTime … now."
 * (services/escalate.ts). group_call_id is null because the call is placed after the response.
 * Never auto-calls 911.
 */
escalate.post("/", async (c) => {
  const body = await jsonBody(c, EscalateBody);
  const r = await escalatePatient(body);
  return c.json({ alert_id: r.alert_id, group_call_id: r.group_call_id } satisfies EscalateResponse);
});
