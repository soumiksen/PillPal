import { Hono } from "hono";
import { DialBody, type DialResponse } from "@pillpal/shared";
import { callLine } from "../calls/index.js";
import { jsonBody } from "../lib/http.js";
import { assertCareTeam, requireUser } from "../lib/auth.js";

export const dial = new Hono();

/**
 * Web demo button / scheduler: ring the patient (web app call, or FaceTime with CALL_TRANSPORT=facetime).
 * 201 from Chert = allocated, not answered. A second dial while the line is busy → 409 {error:"line_busy"}.
 */
dial.post("/", requireUser, async (c) => {
  const body = await jsonBody(c, DialBody);
  await assertCareTeam(c, body.patient_id);
  const placed = await callLine.dial(body.patient_id, body.kind);
  return c.json({ chert_call_id: placed.chert_call_id, room_name: placed.room_name, call_id: placed.call_id } satisfies DialResponse);
});
