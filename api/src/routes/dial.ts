import { Hono } from "hono";
import { DialBody, type DialResponse } from "@pillpal/shared";
import { jsonBody } from "../lib/http.js";
import { newId } from "../lib/stubs.js";
import { assertCareTeam, requireUser } from "../lib/auth.js";

export const dial = new Hono();

/** Web demo button / scheduler: place a FaceTime check-in call. */
dial.post("/", requireUser, async (c) => {
  const body = await jsonBody(c, DialBody);
  await assertCareTeam(c, body.patient_id);
  const room = `pillpal-${body.kind}-${body.patient_id.slice(0, 8)}-${Date.now()}`;
  return c.json({ chert_call_id: `call_${newId()}`, room_name: room } satisfies DialResponse);
});
